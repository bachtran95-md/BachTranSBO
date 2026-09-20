-- Reconciled from production Supabase migration history.
grant update (arrival_mode, arrival_other, updated_at)
on table public.cases
to authenticated;
