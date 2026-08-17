-- ============================================================
-- SocialScraper — profiles + credits system
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- 1. Profile table: 1 row per auth user, starts with 1000 credits
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  credits integer not null default 1000,
  api_token text unique,
  created_at timestamptz not null default now()
);

-- 2. Row Level Security: a user can only view/update their own profile
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- 3. New user signup → auto profile with 1000 credits
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, credits)
  values (new.id, new.email, 1000)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. get_or_create_profile: server side profile lookup (creates if missing)
create or replace function public.get_or_create_profile(uid uuid)
returns public.profiles
language sql security definer set search_path = public
as $$
  insert into public.profiles (id, credits)
  values (uid, 1000)
  on conflict (id) do nothing;
  select * from public.profiles where id = uid;
$$;

-- 5. deduct_credits: atomic debit; returns null when insufficient
create or replace function public.deduct_credits(uid uuid, amount int)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  new_bal int;
begin
  insert into public.profiles (id, credits)
  values (uid, 1000)
  on conflict (id) do nothing;

  update public.profiles
  set credits = credits - amount
  where id = uid and credits >= amount
  returning credits into new_bal;

  return new_bal;
end;
$$;

-- 6. add_credits: admin top-up helper
create or replace function public.add_credits(uid uuid, amount int)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  new_bal int;
begin
  insert into public.profiles (id, credits)
  values (uid, 1000)
  on conflict (id) do nothing;

  update public.profiles
  set credits = credits + amount
  where id = uid
  returning credits into new_bal;

  return new_bal;
end;
$$;

-- 7. Grants for the server (service role bypasses RLS, but keep clean)
grant usage on schema public to anon, authenticated, service_role;
grant all on public.profiles to anon, authenticated, service_role;
grant execute on function public.get_or_create_profile(uuid) to anon, authenticated, service_role;
grant execute on function public.deduct_credits(uuid, int) to anon, authenticated, service_role;
grant execute on function public.add_credits(uuid, int) to anon, authenticated, service_role;
