-- Track speed-reading passage categories so each article type can fill
-- independently instead of stopping after 20 total passages.

alter table public.speed_passages
    add column if not exists category text,
    add column if not exists subtopic text;

-- Existing generated passages were debate-heavy, so treat them as the
-- already-filled debate cache.
update public.speed_passages
set category = 'debate',
    subtopic = coalesce(subtopic, 'legacy debate')
where category is null;

create index if not exists speed_passages_category_target_words_idx
    on public.speed_passages (category, target_words);
