// POST /api/signin — visitor sign-in sheet for 87-14 57th Rd PHA. Saves the lead,
// emails the visitor a confirmation immediately, and notifies the agent.
const { sbInsert, clientIp, readBody } = require('./_lib');

const AGENT_TO  = process.env.LEAD_EMAIL || 'ian@gongrealty.com';
const MAIL_FROM = process.env.LEAD_FROM  || 'Ian Gong <web@gongrealty.com>';
const REPLY_TO  = process.env.REPLY_TO   || 'web@gongrealty.com';
const SITE      = 'https://www.57throadpha.com';

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function send(to, subject, html){
  const key = process.env.RESEND_API_KEY;
  if(!key) return { ok:false, skipped:'no-key' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ Authorization:'Bearer ' + key, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to:[to], reply_to: REPLY_TO, subject, html })
    });
    if(!r.ok) return { ok:false, status:r.status, detail:(await r.text()).slice(0,300) };
    return { ok:true };
  } catch(e){ return { ok:false, error:String(e) }; }
}

function visitorHtml(name){
  const first = (name || '').trim().split(/\s+/)[0] || 'Hello';
  return `
<div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;padding:8px">
  <p style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#b48a3f;margin:0 0 6px">Casa Blanca</p>
  <h1 style="margin:0 0 4px;font-size:26px;font-weight:400;color:#14110e">87&ndash;14 57th Road, Penthouse A</h1>
  <p style="margin:0 0 22px;color:#8a8178;font-size:14px">Elmhurst &middot; Queens</p>

  <p style="font-size:15px;color:#14110e;line-height:1.65;margin:0 0 16px">
    ${esc(first)}, thank you for signing in.
  </p>
  <p style="font-size:15px;color:#14110e;line-height:1.65;margin:0 0 18px">
    A rare top-floor <b>duplex penthouse condominium</b> in Elmhurst &mdash; three bedrooms,
    two baths and 1,232 sq ft over two levels joined by a spiral staircase, with a private
    terrace and protected skyline views reaching the Freedom Tower and Citi Field.
    Offered at <b>$800,000</b>.
  </p>
  <table style="font-size:14px;color:#14110e;border-collapse:collapse;margin:0 0 22px">
    <tr><td style="padding:3px 16px 3px 0;color:#8a8178">Common charges</td><td style="padding:3px 0"><b>$997.15/mo</b></td></tr>
    <tr><td style="padding:3px 16px 3px 0;color:#8a8178">Real estate taxes</td><td style="padding:3px 0"><b>$416.33/mo</b></td></tr>
  </table>

  <p style="margin:0 0 26px"><a href="${SITE}" style="display:inline-block;background:#b48a3f;color:#231a08;text-decoration:none;padding:13px 26px;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">Revisit the listing</a></p>

  <div style="margin:0 0 22px;padding:18px 0;border-top:1px solid #e4dccd;border-bottom:1px solid #e4dccd">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#b48a3f;font-family:Arial,Helvetica,sans-serif">Your contact</p>
    <p style="margin:0;font-size:19px;color:#14110e">Ian Gong</p>
    <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:#6f6558">
      Casa Blanca &middot; <a href="tel:+19143318881" style="color:#8a6a1e;text-decoration:none">914-331-8881</a>
      &middot; <a href="mailto:i.gong@casa-blanca.com" style="color:#8a6a1e;text-decoration:none">i.gong@casa-blanca.com</a>
    </p>
  </div>

  <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#a49b8f;line-height:1.6;margin:0">
    You received this because you signed in on the listing page for 87-14 57th Road, Penthouse A.
  </p>
</div>`;
}

function agentHtml(f, ip){
  const line = (l, v) => `<tr><td style="padding:5px 14px 5px 0;color:#8a8178;white-space:nowrap">${esc(l)}</td><td style="padding:5px 0;color:#14110e"><b>${esc(v || '—')}</b></td></tr>`;
  return `
<div style="font-family:Georgia,serif;max-width:560px">
  <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#b48a3f;margin:0 0 4px">87-14 57th Road, Penthouse A</p>
  <h2 style="margin:0 0 16px;font-weight:400">New sign-in</h2>
  <table style="font-size:15px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif">
    ${line('Date', f.date)}
    ${line('Client', f.client_name)}
    ${line('Agent', f.agent_name)}
    ${line('Email', f.email)}
    ${line('Phone', f.phone)}
    ${line('IP', ip)}
  </table>
  <p style="margin-top:20px;font-family:Arial,sans-serif;font-size:12px;color:#8a8178">
    Also saved to your dashboard: ${SITE}/admin</p>
</div>`;
}

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ ok:false }); return; }
  const body = await readBody(req);
  if(!body){ res.status(400).json({ ok:false }); return; }

  const f = {
    date:        String(body.date || '').slice(0,40).trim(),
    client_name: String(body.client_name || '').slice(0,120).trim(),
    agent_name:  String(body.agent_name || '').slice(0,120).trim(),
    email:       String(body.email || '').slice(0,200).trim(),
    phone:       String(body.phone || '').slice(0,40).trim()
  };
  if(!f.email || !f.client_name){ res.status(400).json({ ok:false, error:'name and email required' }); return; }
  const ip = clientIp(req);

  try {
    await sbInsert('pha_leads', {
      ip, ua: (req.headers['user-agent'] || '').slice(0,300),
      vid: String(body.vid || '').slice(0,80), type: 'signin', fields: f
    });
  } catch(e){ /* the email still matters */ }

  const toVisitor = await send(f.email, 'Thanks for signing in — 87-14 57th Rd, Penthouse A', visitorHtml(f.client_name));
  await send(AGENT_TO, 'New sign-in — ' + (f.client_name || f.email), agentHtml(f, ip));

  res.status(200).json({ ok:true, visitorDelivered: !!toVisitor.ok });
};
