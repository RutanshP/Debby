-- Cached AI-generated speech insights for the Progress dashboard.
-- One row per user; regenerated on demand from their latest transcripts.

create table public.speech_insights (
    user_id        uuid primary key references auth.users (id) on delete cascade,
    summary        jsonb not null,
    rounds_covered int  not null,
    generated_at   timestamptz not null default now()
);

alter table public.speech_insights enable row level security;

create policy "speech_insights: owner read"
    on public.speech_insights for select
    using (auth.uid() = user_id);

create policy "speech_insights: owner write"
    on public.speech_insights for insert
    with check (auth.uid() = user_id);

create policy "speech_insights: owner update"
    on public.speech_insights for update
    using (auth.uid() = user_id);
