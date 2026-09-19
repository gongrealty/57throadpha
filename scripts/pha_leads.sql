-- ============================================================
--  Sign-in leads for 87-14 57th Rd PHA (57throadpha.com)
--
--  Run ONCE in the SAME Supabase project this site already uses for the sensor
--  panel (the `blvdgardens4h` project — where gr_sensor_readings lives).
--  Dashboard -> SQL Editor -> New query -> paste -> Run.
--
--  Prefixed `pha_` so it lives alongside the existing tables without colliding
--  with blvdgardens4h's own `leads` table.
-- ============================================================

create table if not exists public.pha_leads (
  id     bigint generated always as identity primary key,
  ts     timestamptz not null default now(),
  ip     text,
  ua     text,          -- browser user-agent
  vid    text,          -- visitor id (if the page has one)
  type   text,          -- 'signin'
  fields jsonb          -- { date, client_name, agent_name, email, phone }
);

create index if not exists pha_leads_ts_idx on public.pha_leads (ts desc);

-- RLS on with NO policy: unreachable with a public/anon key. The serverless
-- functions use the service_role key server-side, which bypasses RLS. No key is
-- ever exposed to a browser.
alter table public.pha_leads enable row level security;
