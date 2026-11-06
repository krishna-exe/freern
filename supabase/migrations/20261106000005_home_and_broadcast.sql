-- Two changes that keep costs tied to one person's friends, not to all users.
--
-- get_home: everything a signed-in screen needs, in one query.
-- Broadcast: a change pings the topic of each person it affects. The message
-- carries no data; clients reload through get_home, so it can't leak anything.

create schema if not exists private;
revoke all on schema private from public;

create index if not exists plans_user_starts on public.plans (user_id, starts_at);
drop index if exists public.plans_user;

create function public.get_home() returns jsonb
language sql stable security definer set search_path = public as $$
  with links as (
    select case when f.requester = auth.uid() then f.addressee else f.requester end as other_id,
           f.accepted,
           f.requester = auth.uid() as i_asked
    from friendships f
    where f.requester = auth.uid() or f.addressee = auth.uid()
  ),
  people as (
    select l.other_id, l.accepted, l.i_asked,
           jsonb_build_object('id', p.id, 'handle', p.handle, 'name', p.name, 'avatar', p.avatar) as person
    from links l
    join profiles p on p.id = l.other_id
  ),
  -- Only accepted friends and me: this is what keeps status and notes private.
  circle as (
    select other_id as id from people where accepted
    union all
    select auth.uid()
  ),
  visible_plans as (
    select pl.*
    from plans pl
    join circle c on c.id = pl.user_id
    where pl.starts_at > now() - interval '2 hours'
  )
  select jsonb_build_object(
    'me', (
      select jsonb_build_object(
        'id', p.id, 'handle', p.handle, 'name', p.name, 'avatar', p.avatar,
        'freeFrom', s.free_from, 'freeUntil', s.free_until, 'note', s.note, 'noteUntil', s.note_until)
      from profiles p
      join statuses s on s.user_id = p.id
      where p.id = auth.uid()
    ),
    'friends', coalesce((
      select jsonb_agg(pe.person || jsonb_build_object(
        'freeFrom', s.free_from, 'freeUntil', s.free_until, 'note', s.note, 'noteUntil', s.note_until))
      from people pe
      join statuses s on s.user_id = pe.other_id
      where pe.accepted
    ), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(person) from people where not accepted and not i_asked), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(person) from people where not accepted and i_asked), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id,
        'startsAt', pl.starts_at,
        'note', pl.note,
        'host', jsonb_build_object('id', h.id, 'handle', h.handle, 'name', h.name, 'avatar', h.avatar),
        'imIn', exists (select 1 from plan_responses r where r.plan_id = pl.id and r.user_id = auth.uid()),
        'names', coalesce((
          select jsonb_agg(rp.name order by rp.name)
          from plan_responses r
          join circle c on c.id = r.user_id
          join profiles rp on rp.id = r.user_id
          where r.plan_id = pl.id
        ), '[]'::jsonb)
      ) order by pl.starts_at)
      from visible_plans pl
      join profiles h on h.id = pl.user_id
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.get_home() from public, anon;
grant execute on function public.get_home() to authenticated;

-- Live updates ---------------------------------------------------------------
create policy "realtime: read your own topic" on realtime.messages for select to authenticated
  using (realtime.topic() = 'user:' || auth.uid()::text);

create function private.friends_of(person uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select addressee from friendships where requester = person and accepted
  union all
  select requester from friendships where addressee = person and accepted
$$;

create function private.ping(people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  person uuid;
begin
  foreach person in array people loop
    perform realtime.send('{}'::jsonb, 'changed', 'user:' || person::text, true);
  end loop;
end $$;

create function private.ping_self_and_friends(person uuid) returns void
language sql security definer set search_path = public as $$
  select private.ping(person || array(select private.friends_of(person)))
$$;

create function private.on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.ping_self_and_friends(new.user_id);
  return null;
end $$;

create function private.on_profile_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.ping_self_and_friends(new.id);
  return null;
end $$;

create function private.on_friendship_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  link friendships := coalesce(new, old);
begin
  perform private.ping(array[link.requester, link.addressee]);
  return null;
end $$;

create function private.on_plan_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  plan plans := coalesce(new, old);
begin
  perform private.ping_self_and_friends(plan.user_id);
  return null;
end $$;

create function private.on_plan_response_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  host uuid;
begin
  select user_id into host from plans where id = coalesce(new.plan_id, old.plan_id);
  -- No host means the plan itself was just deleted, which already pinged everyone.
  if host is not null then
    perform private.ping_self_and_friends(host);
  end if;
  return null;
end $$;

create trigger ping_on_status after update on public.statuses
  for each row execute function private.on_status_change();
create trigger ping_on_profile after update of name, avatar on public.profiles
  for each row execute function private.on_profile_change();
create trigger ping_on_friendship after insert or update or delete on public.friendships
  for each row execute function private.on_friendship_change();
create trigger ping_on_plan after insert or delete on public.plans
  for each row execute function private.on_plan_change();
create trigger ping_on_plan_response after insert or update or delete on public.plan_responses
  for each row execute function private.on_plan_response_change();
