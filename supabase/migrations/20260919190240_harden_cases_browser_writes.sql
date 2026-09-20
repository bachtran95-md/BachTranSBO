-- Reconciled from production Supabase migration history.
revoke insert, update, delete on table public.cases from authenticated;
revoke all on table public.cases from anon;
