-- ============================================================
-- THE NANEA BOOK — Supabase setup
-- Paste this whole file into Supabase → SQL Editor → New query,
-- then click "Run". You only do this ONCE.
-- ============================================================

-- 1) The table that holds the entire tournament in one row.
create table if not exists public.tournament (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);

-- 2) Turn on Row Level Security.
alter table public.tournament enable row level security;

-- 3) Allow anyone with the app to read and write the shared tournament.
--    (This is a private friend-group app; anyone with the link can play.
--     The PIN inside the app gates commissioner actions.)
drop policy if exists "anon read"  on public.tournament;
drop policy if exists "anon write" on public.tournament;
drop policy if exists "anon update" on public.tournament;

create policy "anon read"   on public.tournament for select using (true);
create policy "anon write"  on public.tournament for insert with check (true);
create policy "anon update" on public.tournament for update using (true) with check (true);

-- 4) Enable realtime so every phone updates live.
alter publication supabase_realtime add table public.tournament;

-- Done. You should see "Success. No rows returned." That's correct —
-- the app creates the data row itself the first time it's used.
