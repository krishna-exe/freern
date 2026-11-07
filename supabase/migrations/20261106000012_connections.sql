-- A log of when two friends last connected, so drifting apart is visible.
-- It's shared: either friend can log, and both see it.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  logged_by uuid not null references public.profiles on delete cascade,
  friend uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('talked', 'hung_out', 'texted')),
  created_at timestamptz not null default now(),
  check (logged_by <> friend)
);

-- Either direction counts as the same pair, and the newest is what's read most.
create index connections_pair_recent on public.connections
  (least(logged_by, friend), greatest(logged_by, friend), created_at desc);

-- Only the functions below touch it.
alter table public.connections enable row level security;
revoke all on public.connections from anon, authenticated;

-- If you both log the same call, it counts once.
create function public.log_connection(friend_id uuid, how text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  entry uuid;
begin
  if not are_friends(friend_id) then
    raise exception 'You can only log with friends.';
  end if;

  select id into entry from connections
  where least(logged_by, friend) = least(auth.uid(), friend_id)
    and greatest(logged_by, friend) = greatest(auth.uid(), friend_id)
    and kind = how
    and created_at > now() - interval '1 hour';

  if entry is null then
    insert into connections (logged_by, friend, kind)
    values (auth.uid(), friend_id, how)
    returning id into entry;
    perform private.ping(array[auth.uid(), friend_id]);
  end if;
  return entry;
end $$;

-- For fixing a mistaken tap, so only the person who logged it can remove it.
create function public.delete_connection(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  delete from connections where id = target and logged_by = auth.uid()
  returning friend into other;
  if other is not null then
    perform private.ping(array[auth.uid(), other]);
  end if;
end $$;

create function public.get_connections(friend_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id,
    'kind', recent.kind,
    'at', recent.created_at,
    'mine', recent.logged_by = auth.uid()
  ) order by recent.created_at desc), '[]'::jsonb)
  from (
    select c.* from connections c
    where are_friends(friend_id)
      and least(c.logged_by, c.friend) = least(auth.uid(), friend_id)
      and greatest(c.logged_by, c.friend) = greatest(auth.uid(), friend_id)
    order by c.created_at desc
    limit 30
  ) as recent
$$;

revoke all on function public.log_connection(uuid, text), public.delete_connection(uuid), public.get_connections(uuid)
  from public, anon;
grant execute on function public.log_connection(uuid, text), public.delete_connection(uuid), public.get_connections(uuid)
  to authenticated;

-- Home ------------------------------------------------------------------------
create function private.last_connection(other uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('kind', c.kind, 'at', c.created_at)
  from connections c
  where least(c.logged_by, c.friend) = least(auth.uid(), other)
    and greatest(c.logged_by, c.friend) = greatest(auth.uid(), other)
  order by c.created_at desc
  limit 1
$$;

create or replace function private.home_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    private.person_json(p) || private.status_json(s) || private.details_json(p.id) || jsonb_build_object(
      'muted', exists (select 1 from private.notify_mutes m where m.user_id = auth.uid() and m.friend_id = p.id),
      'lastConnection', private.last_connection(p.id))
  ), '[]'::jsonb)
  from private.friends_of(auth.uid()) as friend(id)
  join profiles p on p.id = friend.id
  join statuses s on s.user_id = p.id
$$;
