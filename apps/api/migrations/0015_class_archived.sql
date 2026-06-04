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
