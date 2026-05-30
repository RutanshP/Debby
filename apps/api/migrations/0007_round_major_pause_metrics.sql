-- Store simple major-pause counts for practice rounds.

alter table public.rounds
    add column if not exists major_pause_count int not null default 0;

create index if not exists rounds_user_major_pause_created_idx
    on public.rounds (user_id, created_at desc)
    where major_pause_count > 0;
