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
