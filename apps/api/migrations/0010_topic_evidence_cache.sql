create table if not exists public.topic_evidence_cache (
    cache_key text primary key,
    topic text not null,
    normalized_topic text not null,
    side text not null check (side in ('aff', 'neg')),
    cards jsonb not null default '[]'::jsonb,
    provider text not null default 'openai_web_search',
    model text not null default 'gpt-4o-mini',
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists topic_evidence_cache_lookup_idx
    on public.topic_evidence_cache (normalized_topic, side);

create or replace function public.set_topic_evidence_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists topic_evidence_cache_set_updated_at on public.topic_evidence_cache;
create trigger topic_evidence_cache_set_updated_at
    before update on public.topic_evidence_cache
    for each row
    execute function public.set_topic_evidence_cache_updated_at();

alter table public.topic_evidence_cache enable row level security;
