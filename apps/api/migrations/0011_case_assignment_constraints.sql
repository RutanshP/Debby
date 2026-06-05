-- Allow classroom case assignments and their case-review submissions.

alter table public.assignments
    drop constraint if exists assignments_type_check;

alter table public.assignments
    add constraint assignments_type_check
    check (type in ('drill', 'practice_round', 'case'));

alter table public.assignment_submissions
    drop constraint if exists assignment_submissions_check;

alter table public.assignment_submissions
    add constraint assignment_submissions_check
    check (
        (drill_id is not null and round_id is null and case_review_id is null)
        or (drill_id is null and round_id is not null and case_review_id is null)
        or (drill_id is null and round_id is null and case_review_id is not null)
    );
