-- Needs extensions only hosted Supabase has, so tests/local-backend.mjs skips this.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Backstop: picks up anything a dropped wake-up left behind.
create function private.kick_sender_if_pending() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from private.notifications
    where sent_at is null and attempts < 3 and created_at > now() - interval '30 minutes'
  ) then
    perform private.kick_sender();
  end if;
end $$;

-- These tables only grow, so keep them to what's still useful.
create function private.clean_up_old_rows() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from private.notifications where created_at < now() - interval '7 days';
  delete from private.nudges where created_at < now() - interval '7 days';
  delete from private.recovery_failures where failed_at < now() - interval '1 day';
  delete from public.plans where starts_at < now() - interval '30 days';
end $$;

select cron.schedule('freern-send-notifications', '* * * * *', 'select private.kick_sender_if_pending()');
select cron.schedule('freern-clean-up', '17 3 * * *', 'select private.clean_up_old_rows()');
