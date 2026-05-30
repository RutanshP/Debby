-- Store practice-round filler metrics for history, progress, and insights.

alter table public.rounds
    add column if not exists speech_metrics jsonb,
    add column if not exists filler_count int not null default 0,
    add column if not exists filler_per_minute numeric;

create index if not exists rounds_user_filler_created_idx
    on public.rounds (user_id, created_at desc)
    where filler_count > 0;
