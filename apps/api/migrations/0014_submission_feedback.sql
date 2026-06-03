-- Coach feedback and manual grades for assignment recipients.

create table if not exists public.submission_feedback (
    id uuid primary key default gen_random_uuid(),
    recipient_id uuid not null unique references public.assignment_recipients(id) on delete cascade,
    coach_id uuid references auth.users(id),
    grade numeric,
    feedback text,
    returned boolean not null default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table public.submission_feedback enable row level security;

-- Coaches of the recipient's class can read and write feedback.
drop policy if exists "submission_feedback: coach read" on public.submission_feedback;
create policy "submission_feedback: coach read"
    on public.submission_feedback for select
    using (
        exists (
            select 1
            from public.assignment_recipients r
            join public.assignments a on a.id = r.assignment_id
            join public.class_members m on m.class_id = a.class_id
            where r.id = submission_feedback.recipient_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

drop policy if exists "submission_feedback: coach write" on public.submission_feedback;
create policy "submission_feedback: coach write"
    on public.submission_feedback for all
    using (
        exists (
            select 1
            from public.assignment_recipients r
            join public.assignments a on a.id = r.assignment_id
            join public.class_members m on m.class_id = a.class_id
            where r.id = submission_feedback.recipient_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

-- The student who owns the recipient can read their own feedback.
drop policy if exists "submission_feedback: student read own" on public.submission_feedback;
create policy "submission_feedback: student read own"
    on public.submission_feedback for select
    using (
        exists (
            select 1
            from public.assignment_recipients r
            where r.id = submission_feedback.recipient_id
              and r.user_id = auth.uid()
        )
    );
