alter table public.drills
    add column if not exists numeric_score integer,
    add column if not exists duration_seconds numeric,
    add column if not exists wpm integer,
    add column if not exists accuracy numeric,
    add column if not exists completion numeric;

update public.drills
set
    numeric_score = coalesce(numeric_score, nullif(score->>'score', '')::integer),
    duration_seconds = coalesce(duration_seconds, nullif(score->>'duration_seconds', '')::numeric),
    wpm = coalesce(wpm, nullif(score->>'wpm', '')::integer),
    accuracy = coalesce(accuracy, nullif(score->>'accuracy', '')::numeric),
    completion = coalesce(completion, nullif(score->>'completion', '')::numeric)
where score is not null;

create index if not exists drills_user_type_score_created_idx
    on public.drills (user_id, drill_type, numeric_score, created_at desc);

