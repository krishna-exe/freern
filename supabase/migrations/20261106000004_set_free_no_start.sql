-- A start time from the server's clock can look future to a phone whose clock is
-- behind, showing "free later" for someone who just went on. Null means from now.
create or replace function public.set_free(is_free boolean) returns timestamptz
language sql security definer set search_path = public as $$
  update statuses
  set free_from = null,
      free_until = case when is_free then now() + interval '2 hours' end
  where user_id = auth.uid()
  returning free_until
$$;
