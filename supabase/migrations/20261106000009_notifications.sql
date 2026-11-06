-- Push notifications, the "You free?" nudge, and per-friend mutes.
--
-- A change only adds rows to private.notifications, so tapping the switch never
-- waits on a push service. The send-notifications function drains the queue.

create table private.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on private.push_subscriptions (user_id);

create table private.notify_mutes (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  primary key (user_id, friend_id)
);

create table private.notifications (
  id bigint generated always as identity primary key,
  recipient uuid not null references auth.users on delete cascade,
  actor uuid not null references auth.users on delete cascade,
  kind text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts int not null default 0,
  sent_at timestamptz
);
create index notifications_unsent on private.notifications (id) where sent_at is null;
create index notifications_recipient_time on private.notifications (recipient, created_at);

create table private.nudges (
  sender uuid not null references auth.users on delete cascade,
  target uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender, target)
);
create index nudges_target on private.nudges (target);

-- Who gets one -----------------------------------------------------------------
create function private.should_notify(recipient_id uuid, actor_id uuid, notification_kind text, cooldown interval)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from private.push_subscriptions s where s.user_id = recipient_id)
    and not exists (select 1 from private.notify_mutes m where m.user_id = recipient_id and m.friend_id = actor_id)
    and not exists (
      select 1 from private.notifications n
      where n.recipient = recipient_id and n.actor = actor_id and n.kind = notification_kind
        and n.created_at > now() - cooldown
    )
    and (
      select count(*) from private.notifications n
      where n.recipient = recipient_id and n.created_at > now() - interval '1 hour'
    ) < 12
$$;

create function private.is_free_now(s statuses) returns boolean
language sql stable as $$
  select s.free_until > now() and (s.free_from is null or s.free_from <= now())
$$;

create function private.on_went_free() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_name text;
  starts_later boolean := new.free_from is not null and new.free_from > now();
begin
  -- Only the moment someone becomes free counts, not every later adjustment.
  if new.free_until is null or new.free_until <= now()
     or (old.free_until is not null and old.free_until > now()) then
    return null;
  end if;

  select name into actor_name from profiles where id = new.user_id;

  insert into private.notifications (recipient, actor, kind, data)
  select friend.id, new.user_id, picked.kind,
         jsonb_build_object('name', actor_name, 'from', new.free_from, 'until', new.free_until)
  from private.friends_of(new.user_id) as friend(id)
  join statuses s on s.user_id = friend.id
  cross join lateral (
    select case
      when starts_later then 'free_later'
      when private.is_free_now(s) then 'both_free'
      else 'free'
    end as kind
  ) as picked
  where private.should_notify(friend.id, new.user_id, picked.kind, interval '3 hours');

  -- They've answered anyone who asked.
  delete from private.nudges where target = new.user_id;
  return null;
end $$;

create trigger notify_on_went_free after update on public.statuses
  for each row execute function private.on_went_free();

create function private.on_plan_posted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_name text;
begin
  select name into actor_name from profiles where id = new.user_id;

  insert into private.notifications (recipient, actor, kind, data)
  select friend.id, new.user_id, 'plan',
         jsonb_build_object('name', actor_name, 'at', new.starts_at, 'note', new.note)
  from private.friends_of(new.user_id) as friend(id)
  where (
      new.group_id is null
      or exists (select 1 from group_members g where g.group_id = new.group_id and g.member = friend.id)
    )
    and private.should_notify(friend.id, new.user_id, 'plan', interval '0');
  return null;
end $$;

create trigger notify_on_plan_posted after insert on public.plans
  for each row execute function private.on_plan_posted();

-- Waking the sender --------------------------------------------------------------
-- pg_net only queues the request, so this adds no wait. A failure here must never
-- undo the switch, and the scheduled job picks up anything missed.
create function private.kick_sender() returns void
language plpgsql security definer set search_path = public as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'dispatch_secret';
  perform net.http_post(
    url := base_url || '/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning 'could not wake send-notifications: %', sqlerrm;
end $$;

create function private.on_notifications_queued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.kick_sender();
  return null;
end $$;

-- Per statement: telling 50 friends wakes the sender once.
create trigger kick_on_queued after insert on private.notifications
  for each statement execute function private.on_notifications_queued();

-- What the sender calls ------------------------------------------------------------
-- skip locked lets several senders run at once without sending anything twice.
-- A free status goes stale fast, so anything older than 30 minutes is dropped.
create function public.claim_notifications(batch_size int) returns jsonb
language sql security definer set search_path = public as $$
  with picked as (
    select n.id from private.notifications n
    where n.sent_at is null
      and n.attempts < 3
      and n.created_at > now() - interval '30 minutes'
      and (n.claimed_at is null or n.claimed_at < now() - interval '2 minutes')
    order by n.id
    limit batch_size
    for update skip locked
  ),
  claimed as (
    update private.notifications n
    set claimed_at = now(), attempts = n.attempts + 1
    from picked
    where n.id = picked.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'payload', c.data || jsonb_build_object('kind', c.kind, 'actor', c.actor),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint,
        'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)
      ))
      from private.push_subscriptions s
      where s.user_id = c.recipient
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  from claimed c
$$;

create function public.finish_notifications(sent_ids bigint[], dead_endpoints text[]) returns void
language sql security definer set search_path = public as $$
  update private.notifications set sent_at = now() where id = any(sent_ids);
  delete from private.push_subscriptions where endpoint = any(dead_endpoints);
$$;

revoke all on function public.claim_notifications(int), public.finish_notifications(bigint[], text[])
  from public, anon, authenticated;
grant execute on function public.claim_notifications(int), public.finish_notifications(bigint[], text[]) to service_role;

-- What the app calls ---------------------------------------------------------------
create function public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text) returns void
language sql security definer set search_path = public as $$
  insert into private.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (sub_endpoint, auth.uid(), sub_p256dh, sub_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
$$;

create function public.delete_push_subscription(sub_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from private.push_subscriptions where endpoint = sub_endpoint and user_id = auth.uid()
$$;

create function public.set_friend_notify(friend uuid, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if enabled then
    delete from private.notify_mutes where user_id = auth.uid() and friend_id = friend;
  elsif are_friends(friend) then
    insert into private.notify_mutes (user_id, friend_id) values (auth.uid(), friend) on conflict do nothing;
  end if;
  perform private.ping(array[auth.uid()]);
end $$;

-- Asking again is held back for three hours per friend.
create function public.nudge(friend uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  actor_name text;
begin
  if not are_friends(friend) then
    raise exception 'You can only ask friends.';
  end if;

  insert into private.nudges (sender, target) values (auth.uid(), friend)
  on conflict (sender, target) do update set created_at = now()
    where private.nudges.created_at < now() - interval '3 hours';
  if not found then return 'too_soon'; end if;

  select name into actor_name from profiles where id = auth.uid();
  insert into private.notifications (recipient, actor, kind, data)
  select friend, auth.uid(), 'nudge', jsonb_build_object('name', actor_name)
  where private.should_notify(friend, auth.uid(), 'nudge', interval '0');

  perform private.ping(array[friend]);
  return 'sent';
end $$;

create function public.dismiss_nudge(from_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from private.nudges where sender = from_user and target = auth.uid();
  perform private.ping(array[auth.uid()]);
end $$;

revoke all on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.set_friend_notify(uuid, boolean), public.nudge(uuid), public.dismiss_nudge(uuid)
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.set_friend_notify(uuid, boolean), public.nudge(uuid), public.dismiss_nudge(uuid)
  to authenticated;

-- Home --------------------------------------------------------------------------
create or replace function private.home_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    private.person_json(p) || private.status_json(s) || private.details_json(p.id) || jsonb_build_object(
      'muted', exists (select 1 from private.notify_mutes m where m.user_id = auth.uid() and m.friend_id = p.id))
  ), '[]'::jsonb)
  from private.friends_of(auth.uid()) as friend(id)
  join profiles p on p.id = friend.id
  join statuses s on s.user_id = p.id
$$;

-- People asking if you're free, while it's still a fresh question.
create function private.home_nudges() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p)), '[]'::jsonb)
  from private.nudges n
  join private.friends_of(auth.uid()) as friend(id) on friend.id = n.sender
  join profiles p on p.id = n.sender
  where n.target = auth.uid() and n.created_at > now() - interval '2 hours'
$$;

create or replace function public.get_home() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'me', private.home_me(),
    'friends', private.home_friends(),
    'incoming', private.home_incoming(),
    'outgoing', private.home_outgoing(),
    'blocked', private.home_blocked(),
    'groups', private.home_groups(),
    'nudges', private.home_nudges(),
    'plans', private.home_plans()
  )
$$;
