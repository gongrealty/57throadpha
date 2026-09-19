-- ============================================================
--  Main-gallery photos for 87-14 57th Rd PHA (admin-managed)
--  Run ONCE in the blvdgardens4h Supabase project's SQL Editor.
--  Files live in a public Storage bucket named "pha-gallery"
--  (auto-created by the gallery function on first upload).
-- ============================================================

create table if not exists public.pha_gallery (
  id           bigint generated always as identity primary key,
  url          text not null,
  storage_path text,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists pha_gallery_pos_idx on public.pha_gallery (position asc, id asc);

alter table public.pha_gallery enable row level security;

-- Seed the 10 photos the site already ships with, so the Manage Photos panel
-- shows them and the live "Photos" viewer can be reordered/updated. Runs only
-- when the table is empty, so re-running this file is safe.
insert into public.pha_gallery (url, position)
select '/assets/photo-' || g || '.jpg', g
from generate_series(1, 10) as g
where not exists (select 1 from public.pha_gallery);
