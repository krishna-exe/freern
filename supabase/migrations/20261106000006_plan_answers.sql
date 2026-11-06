-- "Can't make it" on plans, plans staying visible while they happen, and get_home
-- split into small functions so a feature only touches the part it changes.

alter table public.plan_responses add column going boolean not null default true;

-- answer is 'in', 'out', or null to take your answer back.
create function public.answer_plan(plan uuid, answer text) returns void
language plpgsql security definer set search_path = public as $$
declare
  host uuid;
begin
  if answer is not null and answer not in ('in', 'out') then
    raise exception 'Unknown answer.';
  end if;
  select user_id into host from plans where id = plan and starts_at > now() - interval '2 hours';
  if host is null or not are_friends(host) then
    raise exception 'This plan isn''t available.';
  end if;
  if answer is null then
    delete from plan_responses where plan_id = plan and user_id = auth.uid();
  else
    insert into plan_responses (plan_id, user_id, going) values (plan, auth.uid(), answer = 'in')
    on conflict (plan_id, user_id) do update set going = excluded.going;
  end if;
end $$;

revoke all on function public.answer_plan(uuid, text) from public, anon;
grant execute on function public.answer_plan(uuid, text) to authenticated;

-- get_home, in parts ----------------------------------------------------------

-- Me and my accepted friends: the people whose status and plans I may see.
create function private.circle() returns setof uuid
language sql stable security definer set search_path = public as $$
  select auth.uid() union all select private.friends_of(auth.uid())
$$;

create function private.person_json(p profiles) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'handle', p.handle, 'name', p.name, 'avatar', p.avatar)
$$;

create function private.status_json(s statuses) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'freeFrom', s.free_from, 'freeUntil', s.free_until, 'note', s.note, 'noteUntil', s.note_until)
$$;

create function private.home_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select private.person_json(p) || private.status_json(s)
  from profiles p
  join statuses s on s.user_id = p.id
  where p.id = auth.uid()
$$;

create function private.home_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p) || private.status_json(s)), '[]'::jsonb)
  from private.friends_of(auth.uid()) as friend(id)
  join profiles p on p.id = friend.id
  join statuses s on s.user_id = p.id
$$;

-- Requests carry names only, never status.
create function private.home_incoming() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p)), '[]'::jsonb)
  from friendships f
  join profiles p on p.id = f.requester
  where f.addressee = auth.uid() and not f.accepted
$$;

create function private.home_outgoing() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p)), '[]'::jsonb)
  from friendships f
  join profiles p on p.id = f.addressee
  where f.requester = auth.uid() and not f.accepted
$$;

create function private.plan_names(plan uuid, is_going boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
  from plan_responses r
  join private.circle() as circle(id) on circle.id = r.user_id
  join profiles p on p.id = r.user_id
  where r.plan_id = plan and r.going = is_going
$$;

-- Plans stay for two hours after they start, while they may still be happening.
create function private.home_plans() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pl.id,
    'startsAt', pl.starts_at,
    'note', pl.note,
    'host', private.person_json(h),
    'myAnswer', (
      select case when r.going then 'in' else 'out' end
      from plan_responses r
      where r.plan_id = pl.id and r.user_id = auth.uid()
    ),
    'inNames', private.plan_names(pl.id, true),
    'outNames', private.plan_names(pl.id, false)
  ) order by pl.starts_at), '[]'::jsonb)
  from private.circle() as circle(id)
  join plans pl on pl.user_id = circle.id
  join profiles h on h.id = pl.user_id
  where pl.starts_at > now() - interval '2 hours'
$$;

create or replace function public.get_home() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'me', private.home_me(),
    'friends', private.home_friends(),
    'incoming', private.home_incoming(),
    'outgoing', private.home_outgoing(),
    'plans', private.home_plans()
  )
$$;
