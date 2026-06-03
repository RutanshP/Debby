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
