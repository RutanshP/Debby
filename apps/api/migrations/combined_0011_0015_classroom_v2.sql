-- Debby Classroom v2 — combined migration (0011–0015).
-- Paste this whole file into the Supabase SQL Editor and Run once.
-- Idempotent: safe to re-run (create-if-not-exists / drop-then-create policies).
-- Requires the base schema (0001_init.sql + 0009_classroom_assignments.sql) to already exist.

begin;

-- ============================================================
-- 0011_profiles.sql
-- ============================================================
-- User profiles with display names.

create table if not exists public.profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can read their own profile.
drop policy if exists "profiles: own read" on public.profiles;
create policy "profiles: own read"
    on public.profiles for select
    using (user_id = auth.uid());

-- A user can insert their own profile.
drop policy if exists "profiles: own insert" on public.profiles;
create policy "profiles: own insert"
    on public.profiles for insert
    with check (user_id = auth.uid());

-- A user can update their own profile.
drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
    on public.profiles for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Class members and coaches can read profiles of users who share a class.
drop policy if exists "profiles: classmates read" on public.profiles;
create policy "profiles: classmates read"
    on public.profiles for select
    using (
        exists (
            select 1
            from public.class_members viewer
            join public.class_members target
              on target.class_id = viewer.class_id
            where viewer.user_id = auth.uid()
              and target.user_id = profiles.user_id
        )
    );

-- ============================================================
-- 0012_class_posts.sql
-- ============================================================
-- Stream feed: announcements and material posts for a class.

create table if not exists public.class_posts (
    id uuid primary key default gen_random_uuid(),
    class_id uuid not null references public.classes(id) on delete cascade,
    author_id uuid not null references auth.users(id) on delete cascade,
    type text not null check (type in ('announcement', 'material')),
    title text,
    body text,
    link_url text,
    created_at timestamptz not null default now()
);

create index if not exists class_posts_class_created_idx
    on public.class_posts (class_id, created_at desc);

alter table public.class_posts enable row level security;

-- Class members can read posts.
drop policy if exists "class_posts: members read" on public.class_posts;
create policy "class_posts: members read"
    on public.class_posts for select
    using (
        exists (
            select 1 from public.class_members m
            where m.class_id = class_posts.class_id and m.user_id = auth.uid()
        )
    );

-- Only coaches of the class can insert posts.
drop policy if exists "class_posts: coaches insert" on public.class_posts;
create policy "class_posts: coaches insert"
    on public.class_posts for insert
    with check (
        exists (
            select 1 from public.class_members m
            where m.class_id = class_posts.class_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

-- Only coaches (or the author) can delete posts.
drop policy if exists "class_posts: coaches or author delete" on public.class_posts;
create policy "class_posts: coaches or author delete"
    on public.class_posts for delete
    using (
        author_id = auth.uid()
        or exists (
            select 1 from public.class_members m
            where m.class_id = class_posts.class_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

-- ============================================================
-- 0013_comments.sql
-- ============================================================
-- Unit 3: Class and private comments on posts and assignments.

create table if not exists public.comments (
    id uuid primary key default gen_random_uuid(),
    class_id uuid not null references public.classes(id) on delete cascade,
    target_type text not null check (target_type in ('post', 'assignment')),
    target_id uuid not null,
    author_id uuid not null references auth.users(id) on delete cascade,
    body text not null,
    is_private boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists comments_target_created_idx
    on public.comments (target_type, target_id, created_at);

alter table public.comments enable row level security;

-- Class members can read non-private comments in their class.
drop policy if exists "comments: members read public" on public.comments;
create policy "comments: members read public"
    on public.comments for select
    using (
        not is_private
        and exists (
            select 1 from public.class_members m
            where m.class_id = comments.class_id and m.user_id = auth.uid()
        )
    );

-- Private comments are readable only by the author and class coaches.
drop policy if exists "comments: private read by author or coach" on public.comments;
create policy "comments: private read by author or coach"
    on public.comments for select
    using (
        is_private
        and (
            author_id = auth.uid()
            or exists (
                select 1 from public.class_members m
                where m.class_id = comments.class_id
                  and m.user_id = auth.uid()
                  and m.role = 'coach'
            )
        )
    );

-- Authors (who must be class members) can insert comments.
drop policy if exists "comments: members insert" on public.comments;
create policy "comments: members insert"
    on public.comments for insert
    with check (
        author_id = auth.uid()
        and exists (
            select 1 from public.class_members m
            where m.class_id = comments.class_id and m.user_id = auth.uid()
        )
    );

-- Authors or coaches can delete comments.
drop policy if exists "comments: author or coach delete" on public.comments;
create policy "comments: author or coach delete"
    on public.comments for delete
    using (
        author_id = auth.uid()
        or exists (
            select 1 from public.class_members m
            where m.class_id = comments.class_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

-- ============================================================
-- 0014_submission_feedback.sql
-- ============================================================
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

-- The student who owns the recipient can read their own feedback, but only once returned.
drop policy if exists "submission_feedback: student read own" on public.submission_feedback;
create policy "submission_feedback: student read own"
    on public.submission_feedback for select
    using (
        submission_feedback.returned = true
        and exists (
            select 1
            from public.assignment_recipients r
            where r.id = submission_feedback.recipient_id
              and r.user_id = auth.uid()
        )
    );

-- ============================================================
-- 0015_class_archived.sql
-- ============================================================
-- Add archived flag to classes for soft-delete / archival.
alter table public.classes
    add column if not exists archived boolean not null default false;

-- Coaches may update their own class (rename, archive).
drop policy if exists "classes: coach update" on public.classes;
create policy "classes: coach update"
    on public.classes for update
    using (
        exists (
            select 1 from public.class_members m
            where m.class_id = classes.id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

-- Coaches may delete members from their class.
drop policy if exists "class_members: coach delete" on public.class_members;
create policy "class_members: coach delete"
    on public.class_members for delete
    using (
        exists (
            select 1 from public.class_members coach
            where coach.class_id = class_members.class_id
              and coach.user_id = auth.uid()
              and coach.role = 'coach'
        )
    );

-- Members may remove themselves (leave).
drop policy if exists "class_members: self delete" on public.class_members;
create policy "class_members: self delete"
    on public.class_members for delete
    using (user_id = auth.uid());

-- Coaches may delete assignments in their class.
drop policy if exists "assignments: coach delete" on public.assignments;
create policy "assignments: coach delete"
    on public.assignments for delete
    using (
        exists (
            select 1 from public.class_members m
            where m.class_id = assignments.class_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

-- Coaches may update assignments in their class.
drop policy if exists "assignments: coach update" on public.assignments;
create policy "assignments: coach update"
    on public.assignments for update
    using (
        exists (
            select 1 from public.class_members m
            where m.class_id = assignments.class_id
              and m.user_id = auth.uid()
              and m.role = 'coach'
        )
    );

commit;
