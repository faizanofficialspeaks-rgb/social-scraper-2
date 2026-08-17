-- FB Poster app: FB session on profile + queue/dedup table
alter table public.profiles
  add column if not exists fb_user_token text,
  add column if not exists fb_page_token text,
  add column if not exists fb_page_id text,
  add column if not exists fb_page_name text;

create table if not exists public.post_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  file_hash     text not null,
  file_name     text not null,
  caption       text not null default '',
  scheduled_for timestamptz not null default now(),
  status        text not null default 'queued',
  fb_post_id    text,
  error         text,
  retry_count   int not null default 0,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,
  unique (user_id, file_hash)
);
create index if not exists post_queue_due_idx
  on public.post_queue (user_id, status, scheduled_for);

alter table public.post_queue enable row level security;

drop policy if exists "post_queue_select_own" on public.post_queue;
create policy "post_queue_select_own"
  on public.post_queue for select using (auth.uid() = user_id);
drop policy if exists "post_queue_insert_own" on public.post_queue;
create policy "post_queue_insert_own"
  on public.post_queue for insert with check (auth.uid() = user_id);
drop policy if exists "post_queue_update_own" on public.post_queue;
create policy "post_queue_update_own"
  on public.post_queue for update using (auth.uid() = user_id);
drop policy if exists "post_queue_delete_own" on public.post_queue;
create policy "post_queue_delete_own"
  on public.post_queue for delete using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated, service_role;
grant all on public.post_queue to anon, authenticated, service_role;