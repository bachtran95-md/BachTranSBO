-- Keep the Supabase Free project active without touching clinical data.
-- This RPC intentionally returns only a constant boolean and uses SECURITY INVOKER.

create or replace function public.bach_sbo_keepalive()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select true;
$$;

revoke all on function public.bach_sbo_keepalive() from public;
grant execute on function public.bach_sbo_keepalive() to anon, authenticated;
