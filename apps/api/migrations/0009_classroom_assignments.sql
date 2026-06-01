-- Classroom MVP: classes, membership, assignments, and submissions.

create table if not exists public.classes (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    join_code text not null unique,
    created_by uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

create table if not exists public.class_members (
    class_id uuid not null references public.classes(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('coach', 'competitor')),
    joined_at timestamptz not null default now(),
    primary key (class_id, user_id)
);

create index if not exists class_members_user_idx
    on public.class_members (user_id, role);

create table if not exists public.assignments (
    id uuid primary key default gen_random_uuid(),
    class_id uuid not null references public.classes(id) on delete cascade,
    assigned_by uuid not null references auth.users(id) on delete cascade,
    title text not null,
    type text not null check (type in ('drill', 'practice_round')),
    payload jsonb not null,
    due_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists assignments_class_created_idx
    on public.assignments (class_id, created_at desc);

create table if not exists public.assignment_recipients (
    id uuid primary key default gen_random_uuid(),
    assignment_id uuid not null references public.assignments(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'assigned'
        check (status in ('assigned', 'in_progress', 'completed')),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (assignment_id, user_id)
);

create index if not exists assignment_recipients_user_status_idx
    on public.assignment_recipients (user_id, status, created_at desc);

create table if not exists public.assignment_submissions (
    id uuid primary key default gen_random_uuid(),
    recipient_id uuid not null references public.assignment_recipients(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    drill_id uuid references public.drills(id) on delete set null,
    round_id uuid references public.rounds(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (recipient_id),
    check (
        (drill_id is not null and round_id is null)
        or (drill_id is null and round_id is not null)
    )
);

create index if not exists assignment_submissions_recipient_idx
    on public.assignment_submissions (recipient_id, created_at desc);

alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_recipients enable row level security;
alter table public.assignment_submissions enable row level security;

drop policy if exists "classes: members read" on public.classes;
create policy "classes: members read"
    on public.classes for select
    using (
        exists (
            select 1 from public.class_members m
            where m.class_id = classes.id and m.user_id = auth.uid()
        )
    );

drop policy if exists "class_members: members read" on public.class_members;
create policy "class_members: members read"
    on public.class_members for select
    using (
        user_id = auth.uid()
        or exists (
            select 1 from public.class_members coach
            where coach.class_id = class_members.class_id
              and coach.user_id = auth.uid()
              and coach.role = 'coach'
        )
    );

drop policy if exists "assignments: members read" on public.assignments;
create policy "assignments: members read"
    on public.assignments for select
    using (
        exists (
            select 1 from public.class_members m
            where m.class_id = assignments.class_id and m.user_id = auth.uid()
        )
    );

drop policy if exists "assignment_recipients: own or coach read" on public.assignment_recipients;
create policy "assignment_recipients: own or coach read"
    on public.assignment_recipients for select
    using (
        user_id = auth.uid()
        or exists (
            select 1
            from public.assignments a
            join public.class_members m on m.class_id = a.class_id
            where a.id = assignment_recipients.assignment_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

drop policy if exists "assignment_submissions: own or coach read" on public.assignment_submissions;
create policy "assignment_submissions: own or coach read"
    on public.assignment_submissions for select
    using (
        user_id = auth.uid()
        or exists (
            select 1
            from public.assignment_recipients r
            join public.assignments a on a.id = r.assignment_id
            join public.class_members m on m.class_id = a.class_id
            where r.id = assignment_submissions.recipient_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );
