-- Run once in Supabase: SQL Editor → New query → paste → Run.

create table public.entries (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null,
  date       date    not null,
  hours      numeric(5, 2) not null check (hours > 0 and hours <= 24),
  note       text    not null default '' check (char_length(note) <= 140),
  created_at bigint  not null, -- client timestamp in ms
  primary key (user_id, id)
);

create index entries_user_date on public.entries (user_id, date);

-- Every row is visible and editable only by the user who owns it.
alter table public.entries enable row level security;

create policy "Read own entries" on public.entries
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Insert own entries" on public.entries
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Update own entries" on public.entries
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Delete own entries" on public.entries
  for delete to authenticated using ((select auth.uid()) = user_id);
