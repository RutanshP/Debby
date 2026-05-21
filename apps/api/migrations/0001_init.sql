-- Debby v2 initial schema.
-- Run against the Supabase Postgres instance (auth schema is provided by Supabase).

create extension if not exists "pgcrypto";

create table public.rounds (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users (id) on delete cascade,
    format              text not null check (format in ('parli', 'mspdp')),
    topic               text not null,
    side                text check (side in ('aff', 'neg')),
    aff_speech          text,
    neg_speech          text,
    aff_two_speech      text,
    rfd                 text,
    flow                jsonb,
    first_speech_wpm    int,
    second_speech_wpm   int,
    average_wpm         int,
    wpm_series          jsonb,
    total_speech_time   interval,
    created_at          timestamptz not null default now()
);

create index rounds_user_id_created_at_idx
    on public.rounds (user_id, created_at desc);

create table public.drills (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users (id) on delete cascade,
    drill_type      text not null,
    prompt          jsonb not null,
    response        text,
    score           jsonb,
    timer_seconds   int,
    created_at      timestamptz not null default now()
);

create index drills_user_id_created_at_idx
    on public.drills (user_id, created_at desc);

create table public.speed_passages (
    id            uuid primary key default gen_random_uuid(),
    target_words  int not null,
    text          text not null,
    created_at    timestamptz not null default now()
);

create index speed_passages_target_words_idx
    on public.speed_passages (target_words);

-- Row-level security.
alter table public.rounds          enable row level security;
alter table public.drills          enable row level security;
alter table public.speed_passages  enable row level security;

create policy "rounds: owner read"
    on public.rounds for select
    using (auth.uid() = user_id);

create policy "rounds: owner write"
    on public.rounds for insert
    with check (auth.uid() = user_id);

create policy "rounds: owner update"
    on public.rounds for update
    using (auth.uid() = user_id);

create policy "drills: owner read"
    on public.drills for select
    using (auth.uid() = user_id);

create policy "drills: owner write"
    on public.drills for insert
    with check (auth.uid() = user_id);

create policy "drills: owner update"
    on public.drills for update
    using (auth.uid() = user_id);

create policy "speed_passages: public read"
    on public.speed_passages for select
    using (true);
