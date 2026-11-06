-- Free RN: who among your friends is free right now.
--
-- Three tables, split so that a pending friend request reveals a name but
-- never availability: profiles are visible to anyone you have a request with,
-- statuses only to accepted friends. All writes except renaming go through
-- the functions below, so a client can't self-accept or set a far-future status.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

-- A person is "on" while free_until is in the future, so a forgotten switch
-- turns itself off rather than showing someone as free all night.
create table public.statuses (
  user_id uuid primary key references public.profiles on delete cascade,
  free_until timestamptz
);

create table public.friendships (
  requester uuid not null references public.profiles on delete cascade,
  addressee uuid not null references public.profiles on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- One row per pair, whichever direction it was requested in.
create unique index friendships_pair on public.friendships
  (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on public.friendships (addressee);

-- Sign-up: the handle is the local part of the synthetic login email.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h text := lower(split_part(new.email, '@', 1));
begin
  insert into profiles (id, handle, name)
  values (new.id, h, coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'name'), 40), ''), h));
  insert into statuses (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers (security definer so policies don't recurse) ---------------------
create function public.are_friends(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where accepted and (
      (requester = auth.uid() and addressee = other) or
      (addressee = auth.uid() and requester = other)
    )
  )
$$;

create function public.has_link(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where (requester = auth.uid() and addressee = other)
       or (addressee = auth.uid() and requester = other)
  )
$$;

-- Actions -------------------------------------------------------------------
create function public.set_free(is_free boolean) returns timestamptz
language sql security definer set search_path = public as $$
  update statuses
  set free_until = case when is_free then now() + interval '2 hours' end
  where user_id = auth.uid()
  returning free_until
$$;

-- Requests a friend by handle. If they already requested you, this accepts it.
create function public.add_friend(friend_handle text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other uuid;
  existing friendships;
begin
  select id into other from profiles
  where handle = lower(trim(ltrim(trim(friend_handle), '@')));
  if other is null then return 'not_found'; end if;
  if other = me then return 'self'; end if;

  select * into existing from friendships
  where (requester = me and addressee = other) or (requester = other and addressee = me);

  if existing is null then
    insert into friendships (requester, addressee) values (me, other);
    return 'requested';
  elsif existing.accepted then
    return 'already_friends';
  elsif existing.requester = me then
    return 'already_requested';
  end if;
  update friendships set accepted = true where requester = other and addressee = me;
  return 'accepted';
end $$;

create function public.accept_friend(from_user uuid) returns void
language sql security definer set search_path = public as $$
  update friendships set accepted = true
  where requester = from_user and addressee = auth.uid()
$$;

-- Row level security --------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.statuses enable row level security;
alter table public.friendships enable row level security;

create policy "profiles: self and anyone you have a request with"
  on public.profiles for select to authenticated
  using (id = auth.uid() or has_link(id));
create policy "profiles: edit self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "statuses: self and accepted friends"
  on public.statuses for select to authenticated
  using (user_id = auth.uid() or are_friends(user_id));

create policy "friendships: either side reads" on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
-- Covers decline, cancel and unfriend.
create policy "friendships: either side deletes" on public.friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- Privileges: RLS picks the rows, these pick the verbs and columns --------------
revoke all on public.profiles, public.statuses, public.friendships from anon, authenticated;
grant select on public.profiles, public.statuses, public.friendships to authenticated;
grant update (name) on public.profiles to authenticated;
grant delete on public.friendships to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.are_friends(uuid), public.has_link(uuid),
  public.set_free(boolean), public.add_friend(text), public.accept_friend(uuid)
  from public, anon;
grant execute on function public.are_friends(uuid), public.has_link(uuid),
  public.set_free(boolean), public.add_friend(text), public.accept_friend(uuid)
  to authenticated;

-- Live updates ----------------------------------------------------------------
alter publication supabase_realtime add table public.statuses, public.friendships;
