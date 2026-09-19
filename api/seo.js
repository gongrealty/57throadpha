// GET /robots.txt and /sitemap.xml (via rewrites) — serves both AND logs which crawler
// fetched them, so AI crawlers that don't run JS (GPTBot, PerplexityBot, ClaudeBot, …)
// are still captured for the admin's engine-visibility panel.
const { sbInsert, clientIp } = require('./_lib');

const CRAWLER = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|gptbot|oai-searchbot|chatgpt-user|perplexity|claudebot|claude-web|anthropic-ai|ccbot|amazonbot|applebot|bytespider|yandex|duckduckbot|google-extended|meta-external/i;

const ROBOTS = `# 87-14 57th Road, Penthouse A — Elmhurst, Queens
# All crawlers welcome, including AI answer engines.

User-agent: *
Allow: /
Disallow: /admin

User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: Bingbot
Allow: /
User-agent: Amazonbot
Allow: /
User-agent: CCBot
Allow: /

Sitemap: https://www.57throadpha.com/sitemap.xml
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.57throadpha.com/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

module.exports = async (req, res) => {
  const isSitemap = /sitemap/i.test(req.url || '');
  try {
    const ua = req.headers['user-agent'] || '';
    if(CRAWLER.test(ua)){
      await sbInsert('pha_events', { ip: clientIp(req), ua: ua.slice(0,300), vid: '',
        event: 'crawl', section: isSitemap ? 'sitemap' : 'robots', t: 0,
        path: isSitemap ? '/sitemap.xml' : '/robots.txt', ref: null });
    }
  } catch(e){ /* logging must never block serving the file */ }
  res.setHeader('Content-Type', isSitemap ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.status(200).send(isSitemap ? SITEMAP : ROBOTS);
};
