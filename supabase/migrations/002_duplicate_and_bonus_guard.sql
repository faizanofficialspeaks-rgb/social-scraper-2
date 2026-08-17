-- ==========================================
-- 002 - Duplicate accounts & signup bonus guard
-- Run in Supabase SQL Editor (after 001_init.sql).
-- ==========================================

-- 1. Enforce one account per email (case-insensitive).
--    Prevents the same email from being used across multiple auth users.
create unique index if not exists profiles_email_unique
  on public.profiles (lower(email));

-- 2. Signup bonus (1000 credits) is granted only once per email.
--    If the same email already has a profile (e.g. an OAuth/linked account),
--    the second account gets NO bonus. Duplicate accounts stay at 0 credits.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, credits)
  select new.id, new.email, 1000
  where not exists (
    select 1 from public.profiles p
    where lower(p.email) = lower(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3. get_or_create_profile: same one-bonus-per-email rule when the profile
--    row was never created (e.g. legacy/edge cases). Existing profiles are
--    returned untouched.
create or replace function public.get_or_create_profile(uid uuid)
returns public.profiles
language sql security definer set search_path = public
as $$
  insert into public.profiles (id, email, credits)
  select u.id, u.email, 1000
  from auth.users u
  where u.id = uid
    and not exists (
      select 1 from public.profiles p
      where p.id = uid
         or (u.email is not null and lower(p.email) = lower(u.email))
    )
  on conflict (id) do nothing;
  select * from public.profiles where id = uid;
$$;
