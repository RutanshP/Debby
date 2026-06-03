-- User profiles with display names.

create table if not exists public.profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can read their own profile.
drop policy if exists "profiles: own read" on public.profiles;
create policy "profiles: own read"
    on public.profiles for select
    using (user_id = auth.uid());

-- A user can insert their own profile.
drop policy if exists "profiles: own insert" on public.profiles;
create policy "profiles: own insert"
    on public.profiles for insert
    with check (user_id = auth.uid());

-- A user can update their own profile.
drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
    on public.profiles for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Class members and coaches can read profiles of users who share a class.
drop policy if exists "profiles: classmates read" on public.profiles;
create policy "profiles: classmates read"
    on public.profiles for select
    using (
        exists (
            select 1
            from public.class_members viewer
            join public.class_members target
              on target.class_id = viewer.class_id
            where viewer.user_id = auth.uid()
              and target.user_id = profiles.user_id
        )
    );
