-- ============================================================
--  Supabase schema for X-Sense sensor readings
--  Run this once: Dashboard -> SQL Editor -> New query -> paste -> Run
--
--  Table name is prefixed "gr_" to match the existing gongrealty.com
--  tables (gr_events, gr_leads), so this is safe to run in the SAME
--  Supabase project without colliding with anything already there.
--
--  Size: one row per sensor per reading. 3 sensors every 15 minutes is
--  about 105,000 rows and ~20 MB per year, against a 500 MB limit.
-- ============================================================

create table if not exists public.gr_sensor_readings (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  house        text,           -- e.g. "87-14 57th Rd PHA"
  station_sn   text,           -- base station serial
  device_id    text not null,  -- stable per-sensor id from X-Sense
  device_name  text,           -- e.g. "Thermo-hygrometer 2"
  model        text,           -- e.g. "STH51"
  temp_c       numeric(5,2),   -- always Celsius; convert for display
  humidity     numeric(5,2),
  battery      integer,
  rf_level     integer,
  online       boolean
);

create index if not exists gr_sensor_readings_ts_idx
  on public.gr_sensor_readings (ts desc);
create index if not exists gr_sensor_readings_device_ts_idx
  on public.gr_sensor_readings (device_id, ts desc);

-- Latest reading per sensor, for the "current temperature" display.
create or replace view public.gr_sensor_latest as
select distinct on (device_id)
  device_id, device_name, model, house, station_sn,
  temp_c, humidity, battery, rf_level, online, ts
from public.gr_sensor_readings
order by device_id, ts desc;

-- ---- Access control -----------------------------------------------
-- Row Level Security is ON with NO read policy at all, so the table is
-- unreachable with a public/anon key. Both the writer (GitHub Actions) and
-- the reader (the /api/conditions function on the listing site) use the
-- service role key server-side, which bypasses RLS. No database key is ever
-- exposed to a browser.
alter table public.gr_sensor_readings enable row level security;
