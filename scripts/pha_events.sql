-- ============================================================
--  Visit + crawler events for 87-14 57th Rd PHA (57throadpha.com)
--  Run ONCE in the blvdgardens4h Supabase project's SQL Editor.
--  Prefixed pha_ so it lives alongside the existing tables.
-- ============================================================

create table if not exists public.pha_events (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  ip      text,
  ua      text,       -- user-agent
  vid     text,       -- visitor id
  event   text,       -- 'pageview' | 'section_view' | 'crawl' | 'admin_login_ok' | 'admin_login_fail'
  section text,
  t       integer,
  path    text,
  ref     text
);

create index if not exists pha_events_id_idx    on public.pha_events (id desc);
create index if not exists pha_events_event_idx on public.pha_events (event);

alter table public.pha_events enable row level security;
