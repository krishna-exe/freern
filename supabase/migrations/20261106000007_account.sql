-- Recovery codes, deleting your account, and blocking.

-- Recovery codes --------------------------------------------------------------
-- Only a hash is stored. The code is random enough that a fast hash is safe, and
-- wrong guesses are limited per account.
create table private.recovery_codes (
  user_id uuid primary key references auth.users on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now()
);

create table private.recovery_failures (
  user_id uuid not null references auth.users on delete cascade,
  failed_at timestamptz not null default now()
);
create index recovery_failures_user_time on private.recovery_failures (user_id, failed_at);

create function private.hash_recovery_code(code text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(upper(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

-- Makes a new code, replacing any old one. This is the only time it's readable.
create function public.new_recovery_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  raw text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
begin
  insert into private.recovery_codes (user_id, code_hash)
  values (auth.uid(), private.hash_recovery_code(raw))
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now();
  return substr(raw, 1, 5) || '-' || substr(raw, 6, 5) || '-' || substr(raw, 11, 5) || '-' || substr(raw, 16, 5);
end $$;

-- Called by the reset-password function. Returns the account if the code is right.
create function public.check_recovery_code(user_handle text, code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  account uuid;
  recent_failures int;
begin
  select id into account from profiles where handle = lower(trim(user_handle));
  if account is null then return null; end if;

  select count(*) into recent_failures from private.recovery_failures
  where user_id = account and failed_at > now() - interval '1 hour';
  if recent_failures >= 5 then return null; end if;

  if exists (
    select 1 from private.recovery_codes
    where user_id = account and code_hash = private.hash_recovery_code(code)
  ) then
    return account;
  end if;

  insert into private.recovery_failures (user_id) values (account);
  return null;
end $$;

-- A code works once. Called after the password has changed.
create function public.use_recovery_code(account uuid) returns void
language sql security definer set search_path = public as $$
  delete from private.recovery_codes where user_id = account;
  delete from private.recovery_failures where user_id = account;
$$;

revoke all on function public.new_recovery_code() from public, anon;
grant execute on function public.new_recovery_code() to authenticated;
revoke all on function public.check_recovery_code(text, text), public.use_recovery_code(uuid)
  from public, anon, authenticated;
grant execute on function public.check_recovery_code(text, text), public.use_recovery_code(uuid) to service_role;

-- Deleting your account -------------------------------------------------------
-- Everything else hangs off auth.users and goes with it.
create function public.delete_account(confirm_handle text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and handle = lower(trim(confirm_handle))) then
    raise exception 'That isn''t your user ID.';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_account(text) from public, anon;
grant execute on function public.delete_account(text) to authenticated;

-- Blocking --------------------------------------------------------------------
-- No policies: only these functions can touch it, so a blocked person can't tell.
create table public.blocks (
  blocker uuid not null references public.profiles on delete cascade,
  blocked uuid not null references public.profiles on delete cascade,
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index blocks_blocked on public.blocks (blocked);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;

create function public.block_user(other uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into blocks (blocker, blocked) values (auth.uid(), other) on conflict do nothing;
  delete from friendships
  where (requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid());
end $$;

create function public.unblock_user(other uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from blocks where blocker = auth.uid() and blocked = other;
  perform private.ping(array[auth.uid()]);
end $$;

revoke all on function public.block_user(uuid), public.unblock_user(uuid) from public, anon;
grant execute on function public.block_user(uuid), public.unblock_user(uuid) to authenticated;

-- Someone who blocked you looks like an ID that doesn't exist.
create or replace function public.add_friend(friend_handle text) returns text
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
  if exists (select 1 from blocks where blocker = other and blocked = me) then return 'not_found'; end if;
  if exists (select 1 from blocks where blocker = me and blocked = other) then return 'you_blocked'; end if;

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

-- Home ------------------------------------------------------------------------
create or replace function private.home_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select private.person_json(p) || private.status_json(s) || jsonb_build_object(
    'hasRecoveryCode', exists (select 1 from private.recovery_codes c where c.user_id = p.id))
  from profiles p
  join statuses s on s.user_id = p.id
  where p.id = auth.uid()
$$;

create function private.home_blocked() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p)), '[]'::jsonb)
  from blocks b
  join profiles p on p.id = b.blocked
  where b.blocker = auth.uid()
$$;

create or replace function public.get_home() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'me', private.home_me(),
    'friends', private.home_friends(),
    'incoming', private.home_incoming(),
    'outgoing', private.home_outgoing(),
    'blocked', private.home_blocked(),
    'plans', private.home_plans()
  )
$$;
