-- Store Case Builder outputs so users can return to generated cases later.

create table if not exists public.saved_cases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    topic text not null,
    format text not null check (format in ('parli', 'mspdp')),
    side text not null check (side in ('aff', 'neg')),
    content text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists saved_cases_user_created_idx
    on public.saved_cases (user_id, created_at desc);

create or replace function public.set_saved_cases_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists saved_cases_set_updated_at on public.saved_cases;
create trigger saved_cases_set_updated_at
    before update on public.saved_cases
    for each row
    execute function public.set_saved_cases_updated_at();

alter table public.saved_cases enable row level security;

drop policy if exists "saved_cases: owner read" on public.saved_cases;
create policy "saved_cases: owner read"
    on public.saved_cases for select
    using (auth.uid() = user_id);

drop policy if exists "saved_cases: owner insert" on public.saved_cases;
create policy "saved_cases: owner insert"
    on public.saved_cases for insert
    with check (auth.uid() = user_id);

drop policy if exists "saved_cases: owner update" on public.saved_cases;
create policy "saved_cases: owner update"
    on public.saved_cases for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "saved_cases: owner delete" on public.saved_cases;
create policy "saved_cases: owner delete"
    on public.saved_cases for delete
    using (auth.uid() = user_id);
