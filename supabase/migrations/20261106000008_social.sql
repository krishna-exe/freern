-- WhatsApp number and "usually free" hint, and groups for plans.

-- Details only friends see ----------------------------------------------------
-- In the private schema, so nothing can reach it except the functions below.
create table private.friend_details (
  user_id uuid primary key references auth.users on delete cascade,
  whatsapp text check (whatsapp ~ '^[0-9]{8,15}$'),
  usually text check (char_length(usually) <= 40)
);

create function public.set_details(whatsapp_number text, usually_free text) returns void
language plpgsql security definer set search_path = public as $$
declare
  digits text := nullif(regexp_replace(coalesce(whatsapp_number, ''), '[^0-9]', '', 'g'), '');
  hint text := nullif(trim(coalesce(usually_free, '')), '');
begin
  if digits is not null and digits !~ '^[0-9]{8,15}$' then
    raise exception 'Enter the full number with country code, like +91 98765 43210.';
  end if;
  if char_length(hint) > 40 then
    raise exception 'Keep that to 40 characters.';
  end if;
  insert into private.friend_details (user_id, whatsapp, usually)
  values (auth.uid(), digits, hint)
  on conflict (user_id) do update set whatsapp = excluded.whatsapp, usually = excluded.usually;
  perform private.ping_self_and_friends(auth.uid());
end $$;

revoke all on function public.set_details(text, text) from public, anon;
grant execute on function public.set_details(text, text) to authenticated;

create function private.details_json(person uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('whatsapp', d.whatsapp, 'usually', d.usually)
  from (select 1) as always
  left join private.friend_details d on d.user_id = person
$$;

-- Groups ----------------------------------------------------------------------
-- A group is one person's private list, so its members never learn it exists.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 30)
);
create index groups_owner on public.groups (owner);

create table public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  member uuid not null references public.profiles on delete cascade,
  primary key (group_id, member)
);
create index group_members_member on public.group_members (member);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.groups, public.group_members from anon, authenticated;

-- Deleting a group deletes its plans. They must never fall back to all friends.
alter table public.plans add column group_id uuid references public.groups on delete cascade;
create index plans_group on public.plans (group_id);

create function private.can_see_plan(plan plans) returns boolean
language sql stable security definer set search_path = public as $$
  select plan.user_id = auth.uid() or (
    are_friends(plan.user_id) and (
      plan.group_id is null
      or exists (select 1 from group_members g where g.group_id = plan.group_id and g.member = auth.uid())
    )
  )
$$;

drop policy "plans: host and friends read" on public.plans;
create policy "plans: whoever it's for" on public.plans for select to authenticated
  using (private.can_see_plan(plans));
grant usage on schema private to authenticated;
grant execute on function private.can_see_plan(plans) to authenticated;

create function public.create_group(group_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  insert into groups (owner, name) values (auth.uid(), trim(group_name)) returning id into new_id;
  perform private.ping(array[auth.uid()]);
  return new_id;
end $$;

create function public.delete_group(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from groups where id = target and owner = auth.uid();
  perform private.ping_self_and_friends(auth.uid());
end $$;

create function public.set_group_member(target uuid, friend uuid, included boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from groups where id = target and owner = auth.uid()) then
    raise exception 'That group isn''t yours.';
  end if;
  if not included then
    delete from group_members where group_id = target and member = friend;
  elsif are_friends(friend) then
    insert into group_members (group_id, member) values (target, friend) on conflict do nothing;
  else
    raise exception 'Only friends can be in a group.';
  end if;
  perform private.ping_self_and_friends(auth.uid());
end $$;

drop function public.create_plan(timestamptz, text);
create function public.create_plan(at timestamptz, note text, audience uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if at <= now() then
    raise exception 'Pick a time in the future.';
  end if;
  if audience is not null and not exists (select 1 from groups where id = audience and owner = auth.uid()) then
    raise exception 'That group isn''t yours.';
  end if;
  insert into plans (user_id, starts_at, note, group_id)
  values (auth.uid(), at, trim(coalesce(note, '')), audience)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.answer_plan(plan uuid, answer text) returns void
language plpgsql security definer set search_path = public as $$
declare
  target plans;
begin
  if answer is not null and answer not in ('in', 'out') then
    raise exception 'Unknown answer.';
  end if;
  select * into target from plans where id = plan and starts_at > now() - interval '2 hours';
  if target.id is null or target.user_id = auth.uid() or not private.can_see_plan(target) then
    raise exception 'This plan isn''t available.';
  end if;
  if answer is null then
    delete from plan_responses where plan_id = plan and user_id = auth.uid();
  else
    insert into plan_responses (plan_id, user_id, going) values (plan, auth.uid(), answer = 'in')
    on conflict (plan_id, user_id) do update set going = excluded.going;
  end if;
end $$;

revoke all on function public.create_group(text), public.delete_group(uuid),
  public.set_group_member(uuid, uuid, boolean), public.create_plan(timestamptz, text, uuid)
  from public, anon;
grant execute on function public.create_group(text), public.delete_group(uuid),
  public.set_group_member(uuid, uuid, boolean), public.create_plan(timestamptz, text, uuid)
  to authenticated;

-- Home ------------------------------------------------------------------------
create or replace function private.home_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select private.person_json(p) || private.status_json(s) || private.details_json(p.id) || jsonb_build_object(
    'hasRecoveryCode', exists (select 1 from private.recovery_codes c where c.user_id = p.id))
  from profiles p
  join statuses s on s.user_id = p.id
  where p.id = auth.uid()
$$;

create or replace function private.home_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p) || private.status_json(s) || private.details_json(p.id)), '[]'::jsonb)
  from private.friends_of(auth.uid()) as friend(id)
  join profiles p on p.id = friend.id
  join statuses s on s.user_id = p.id
$$;

create or replace function private.home_plans() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pl.id,
    'startsAt', pl.starts_at,
    'note', pl.note,
    'host', private.person_json(h),
    -- Only the host hears the group's name.
    'groupName', (select g.name from groups g where g.id = pl.group_id and g.owner = auth.uid()),
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
  where pl.starts_at > now() - interval '2 hours' and private.can_see_plan(pl)
$$;

create function private.home_groups() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'memberIds', coalesce((select jsonb_agg(m.member) from group_members m where m.group_id = g.id), '[]'::jsonb)
  ) order by g.name), '[]'::jsonb)
  from groups g
  where g.owner = auth.uid()
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
    'plans', private.home_plans()
  )
$$;
