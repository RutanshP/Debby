-- Persist round winners separately from generated flow JSON for history stats.

alter table public.rounds
    add column if not exists winner_side text check (winner_side in ('aff', 'neg'));
