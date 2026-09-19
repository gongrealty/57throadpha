// GET /api/admin/data — aggregated dashboard data (requires admin session)
//   By default, bots/crawlers are filtered out. Add ?bots=1 to include them.
const { sbSelectAll, sbCount, isAdmin } = require('../_lib');

// Detailed analytics run over the most recent slice of history so the dashboard stays fast
// no matter how large the events table grows. Lifetime totals come from cheap count queries.
const MAX_EVENTS = 25000;

// Search + AI engines we want to see discover the listing. Each row lights up on first crawl.
const TARGET_ENGINES = [
  { key:'openai',      name:'OpenAI · ChatGPT',        kind:'ai',     re:/gptbot|oai-searchbot|chatgpt-user/i },
  { key:'perplexity',  name:'Perplexity',              kind:'ai',     re:/perplexitybot|perplexity-user/i },
  { key:'anthropic',   name:'Anthropic · Claude',      kind:'ai',     re:/claudebot|claude-web|anthropic-ai/i },
  { key:'google_ai',   name:'Google Gemini (Extended)',kind:'ai',     re:/google-extended/i },
  { key:'commoncrawl', name:'Common Crawl (AI corpus)',kind:'ai',     re:/ccbot/i },
  { key:'amazon',      name:'Amazon · Alexa',          kind:'ai',     re:/amazonbot/i },
  { key:'meta',        name:'Meta AI',                 kind:'ai',     re:/facebookexternalhit|meta-externalagent|facebookbot/i },
  { key:'google',      name:'Google Search',           kind:'search', re:/googlebot|google-inspectiontool|storebot-google/i },
  { key:'bing',        name:'Microsoft Bing / Copilot',kind:'search', re:/bingbot|bingpreview|msnbot/i },
  { key:'apple',       name:'Apple · Siri & Spotlight',kind:'search', re:/applebot/i },
  { key:'duckduckgo',  name:'DuckDuckGo',              kind:'search', re:/duckduckbot|duckduckgo/i },
  { key:'yandex',      name:'Yandex',                  kind:'search', re:/yandex/i }
];

// ---- IP geolocation (+ a datacenter/hosting flag used for bot detection) ----
// Cached per warm function instance so repeated dashboard loads don't re-query.
const geoCache = {};   // ip -> {country, cc, region, city, dc} | null (known miss)

// crawler / automation user-agents (real browsers never match these; empty UA is also a bot)
const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|pinterest|redditbot|slackbot|telegrambot|whatsapp|discordbot|headless|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|go-http-client|okhttp|libwww|curl\/|wget\/|java\/|apache-httpclient|scrapy|axios\/|node-fetch|dataprovider|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|yandex|baidu|sogou|censys|masscan|zgrab|expanse|paloalto|gptbot|claudebot|ccbot|amazonbot|applebot|facebookbot|meta-external|scan\b/i;

function isPublicIp(ip){
  return !!ip && ip !== 'unknown' &&
    !/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) &&
    !/^(::1|fe80:|fc|fd)/i.test(ip);
}

async function geoLookup(ips){
  const need = [];
  ips.forEach(ip => { if(isPublicIp(ip) && !(ip in geoCache)) need.push(ip); });
  for(let i = 0; i < need.length; i += 100){          // ip-api batch: up to 100 IPs/request
    const chunk = need.slice(i, i + 100);
    try {
      const r = await fetch('http://ip-api.com/batch?fields=status,country,countryCode,regionName,city,lat,lon,hosting,query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk)
      });
      const arr = await r.json();
      if(Array.isArray(arr)) arr.forEach(o => {
        if(!o || !o.query) return;
        if(o.status !== 'success'){ geoCache[o.query] = null; return; }
        // `dc` = datacenter/hosting IP (a real household/mobile visitor is never on one).
        // We deliberately do NOT use ip-api's `proxy` flag: it also trips on Apple Private
        // Relay, corporate networks and mobile carriers — i.e. real people.
        geoCache[o.query] = { country:o.country, cc:o.countryCode, region:o.regionName, city:o.city,
          lat: (typeof o.lat === 'number' ? o.lat : null), lon: (typeof o.lon === 'number' ? o.lon : null),
          dc: !!o.hosting };
      });
    } catch(e){ /* leave uncached — retried on the next load */ }
  }
  const out = {};
  ips.forEach(ip => { if(geoCache[ip]) out[ip] = geoCache[ip]; });
  return out;
}

module.exports = async (req, res) => {
  if(!isAdmin(req)){ res.status(401).json({ ok:false }); return; }
  const includeBots = String(req.url || '').indexOf('bots=1') !== -1;
  const includeSelf = String(req.url || '').indexOf('self=1') !== -1;

  let allEvents, leadsRaw, lifetime = {};
  try {
    // newest-first and capped, so query cost stays flat as the table grows.
    // Only the columns the dashboard actually renders (t/path/ref are unused).
    allEvents = await sbSelectAll('pha_events', 'select=ts,ip,ua,vid,event,section&order=id.desc', 1000, MAX_EVENTS);
    leadsRaw  = await sbSelectAll('pha_leads',  'select=id,ts,ip,ua,vid,type,fields&order=id.desc', 1000, 5000);
  } catch(e){
    res.status(500).json({ ok:false, error:'database' }); return;
  }
  // exact lifetime figures without transferring rows — never fatal
  try {
    lifetime.events    = await sbCount('pha_events', 'select=id&vid=neq.admin');
    lifetime.pageviews = await sbCount('pha_events', 'select=id&event=eq.pageview');
  } catch(e){ lifetime = {}; }

  // keep admin-login events out of the visitor analytics
  const visitorEvents = allEvents.filter(e => e.vid !== 'admin');
  const adminAccess = allEvents            // allEvents is newest-first
    .filter(e => e.event === 'admin_login_ok' || e.event === 'admin_login_fail')
    .slice(0, 100)
    .map(e => ({ ts:e.ts, ip:e.ip, ua:e.ua, ok: e.event === 'admin_login_ok' }));

  // "your own" IPs = any IP that has successfully signed into this admin panel
  // (auto-captures each network you test from, no manual list to maintain),
  // plus a small manual seed for networks Ian browses from but hasn't logged in on.
  const OWNER_IPS_SEED = ['160.72.129.18'];
  const ownerIps = new Set([
    ...allEvents.filter(e => e.event === 'admin_login_ok' && e.ip).map(e => e.ip),
    ...OWNER_IPS_SEED
  ]);

  // geolocate all IPs first (geo carries the datacenter flag we need for bot detection)
  const ipSet = new Set();
  visitorEvents.forEach(e => ipSet.add(e.ip || 'unknown'));
  adminAccess.forEach(a => { if(a.ip) ipSet.add(a.ip); });
  leadsRaw.forEach(l => { if(l.ip) ipSet.add(l.ip); });
  let geo = {};
  try { geo = await geoLookup(Array.from(ipSet)); } catch(e){ geo = {}; }

  // decide which IPs are bots: crawler/automation UA, empty UA, or a datacenter/hosting network
  const uaByIp = {};
  visitorEvents.forEach(e => { if(e.ua) uaByIp[e.ip || 'unknown'] = e.ua; });
  const botIps = new Set();
  ipSet.forEach(ip => {
    const ua = uaByIp[ip] || '';
    const g = geo[ip];
    if(!ua || BOT_UA.test(ua) || (g && g.dc)) botIps.add(ip);
  });
  function isBotEvent(e){ return botIps.has(e.ip || 'unknown'); }
  function isOwnEvent(e){ return ownerIps.has(e.ip); }

  // what the dashboard shows: exclude bots (unless ?bots=1) and your own visits (unless ?self=1)
  const events = visitorEvents.filter(e =>
    (includeBots || !isBotEvent(e)) && (includeSelf || !isOwnEvent(e)));

  // group by IP
  const byIp = {};
  events.forEach(e => {
    const k = e.ip || 'unknown';
    if(!byIp[k]) byIp[k] = { ip:k, visits:0, sections:{}, vids:new Set(), first:e.ts, last:e.ts, ua:e.ua };
    const g = byIp[k];
    // order-independent: track the true min/max timestamps for this IP
    g.visits++;
    if(e.ts > g.last)  g.last  = e.ts;
    if(e.ts < g.first) g.first = e.ts;
    if(e.vid) g.vids.add(e.vid);
    if(e.event === 'section_view' && e.section) g.sections[e.section] = (g.sections[e.section]||0)+1;
    if(e.ua) g.ua = e.ua;
  });
  const visitors = Object.values(byIp).map(g => ({
    ip:g.ip, visits:g.visits, uniqueVisitors:g.vids.size,
    sections:g.sections, first:g.first, last:g.last, ua:g.ua,
    bot: botIps.has(g.ip), own: ownerIps.has(g.ip)
  })).sort((a,b) => b.last.localeCompare(a.last));

  // section popularity
  const sectionCounts = {};
  events.filter(e => e.event === 'section_view').forEach(e => {
    sectionCounts[e.section] = (sectionCounts[e.section]||0)+1;
  });

  // raw pageview timestamps (epoch ms) — the client re-buckets these per selected range
  const pageviewTimes = events.filter(e => e.event === 'pageview')
    .map(e => Date.parse(e.ts)).filter(n => !isNaN(n)).sort((a,b) => a-b);

  // map points: one per located IP, weighted by its event count (respects the bot filter)
  const geoPoints = Object.values(byIp).map(g => {
    const gg = geo[g.ip];
    if(!gg || gg.lat == null || gg.lon == null) return null;
    return { lat:gg.lat, lon:gg.lon, city:gg.city, region:gg.region, cc:gg.cc, events:g.visits };
  }).filter(Boolean);

  // search + AI engine crawl activity (from JS-rendering bots AND robots.txt/sitemap fetches)
  const crawlers = TARGET_ENGINES.map(eng => {
    let count = 0, first = null, last = null;
    for(const e of allEvents){
      if(e.ua && eng.re.test(e.ua)){
        count++;
        if(!first || e.ts < first) first = e.ts;
        if(!last  || e.ts > last)  last  = e.ts;
      }
    }
    return { key:eng.key, name:eng.name, kind:eng.kind, seen: count > 0, count, first, last };
  });
  const crawlerSummary = {
    total: TARGET_ENGINES.length,
    seen: crawlers.filter(c => c.seen).length,
    aiSeen: crawlers.filter(c => c.kind === 'ai' && c.seen).length,
    aiTotal: TARGET_ENGINES.filter(e => e.kind === 'ai').length
  };

  // how much was hidden (always measured against the full data set)
  const botEventCount = visitorEvents.filter(isBotEvent).length;
  const botPageviews  = visitorEvents.filter(e => e.event === 'pageview' && isBotEvent(e)).length;
  const botIpCount    = Array.from(ipSet).filter(ip => botIps.has(ip) && ip !== 'unknown').length;
  const selfEventCount = visitorEvents.filter(isOwnEvent).length;
  const selfPageviews  = visitorEvents.filter(e => e.event === 'pageview' && isOwnEvent(e)).length;
  const selfIpCount    = ownerIps.size;

  res.status(200).json({
    ok:true,
    geo,
    botsIncluded: includeBots,
    selfIncluded: includeSelf,
    botStats: { hiddenIps: botIpCount, hiddenEvents: botEventCount, hiddenPageviews: botPageviews },
    selfStats: { hiddenIps: selfIpCount, hiddenEvents: selfEventCount, hiddenPageviews: selfPageviews },
    summary: {
      totalEvents: events.length,
      uniqueIps: Object.keys(byIp).length,
      pageviews: events.filter(e => e.event === 'pageview').length,
      leads: leadsRaw.length
    },
    sectionCounts,
    pageviewTimes,
    geoPoints,
    crawlers,
    crawlerSummary,
    visitors,
    adminAccess,
    leads: leadsRaw,                 // already newest-first
    recent: events.slice(0, 1000),   // already newest-first
    lifetime,
    windowed: allEvents.length >= MAX_EVENTS,   // detail limited to the newest MAX_EVENTS
    windowSize: MAX_EVENTS
  });
};
