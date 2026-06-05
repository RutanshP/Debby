create table if not exists public.case_reviews (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    format text not null check (format in ('parli', 'mspdp')),
    topic text not null default '',
    side text not null check (side in ('aff', 'neg')),
    source_text text not null,
    score integer not null check (score between 1 and 10),
    category text not null,
    summary text not null,
    feedback text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists case_reviews_user_created_idx
    on public.case_reviews (user_id, created_at desc);

alter table public.assignment_submissions
    add column if not exists case_review_id uuid references public.case_reviews(id) on delete set null;

alter table public.case_reviews enable row level security;

drop policy if exists "case_reviews: own read" on public.case_reviews;
create policy "case_reviews: own read"
    on public.case_reviews for select
    using (auth.uid() = user_id);

drop policy if exists "case_reviews: own insert" on public.case_reviews;
create policy "case_reviews: own insert"
    on public.case_reviews for insert
    with check (auth.uid() = user_id);
