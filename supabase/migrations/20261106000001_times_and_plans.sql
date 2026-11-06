-- From-to availability, and plans friends can join.

-- Null or past free_from means free from now until free_until.
alter table public.statuses add column free_from timestamptz;

create or replace function public.set_free(is_free boolean) returns timestamptz
language sql security definer set search_path = public as $$
  update statuses
  set free_from = case when is_free then now() end,
      free_until = case when is_free then now() + interval '2 hours' end
  where user_id = auth.uid()
  returning free_until
$$;

create function public.set_times(from_at timestamptz, until_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if until_at <= greatest(from_at, now()) then
    raise exception 'The end time has to be after the start time.';
  end if;
  if until_at > now() + interval '2 days' then
    raise exception 'Pick a time within the next day. Use a plan for later dates.';
  end if;
  update statuses set free_from = from_at, free_until = until_at where user_id = auth.uid();
end $$;

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  starts_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 140),
  created_at timestamptz not null default now()
);
create index plans_user on public.plans (user_id);

-- A row means "I'm in".
create table public.plan_responses (
  plan_id uuid not null references public.plans on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (plan_id, user_id)
);
create index plan_responses_user on public.plan_responses (user_id);

create function public.create_plan(at timestamptz, note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if at <= now() then
    raise exception 'Pick a time in the future.';
  end if;
  insert into plans (user_id, starts_at, note)
  values (auth.uid(), at, trim(coalesce(note, '')))
  returning id into new_id;
  return new_id;
end $$;

-- Only friends of the host can join, and only before it starts.
create function public.respond_plan(plan uuid, going boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  host uuid;
begin
  select user_id into host from plans where id = plan and starts_at > now();
  if host is null or not are_friends(host) then
    raise exception 'This plan isn''t available.';
  end if;
  if going then
    insert into plan_responses (plan_id, user_id) values (plan, auth.uid())
    on conflict do nothing;
  else
    delete from plan_responses where plan_id = plan and user_id = auth.uid();
  end if;
end $$;

alter table public.plans enable row level security;
alter table public.plan_responses enable row level security;

create policy "plans: host and friends read" on public.plans for select to authenticated
  using (user_id = auth.uid() or are_friends(user_id));
create policy "plans: host deletes" on public.plans for delete to authenticated
  using (user_id = auth.uid());

-- Friends only, so a host's other friends you don't know stay hidden.
create policy "plan_responses: self, or friends on plans you can see"
  on public.plan_responses for select to authenticated
  using (user_id = auth.uid() or (
    are_friends(user_id) and exists (select 1 from plans p where p.id = plan_id)
  ));

revoke all on public.plans, public.plan_responses from anon, authenticated;
grant select on public.plans, public.plan_responses to authenticated;
grant delete on public.plans to authenticated;

revoke all on function public.set_times(timestamptz, timestamptz),
  public.create_plan(timestamptz, text), public.respond_plan(uuid, boolean)
  from public, anon;
grant execute on function public.set_times(timestamptz, timestamptz),
  public.create_plan(timestamptz, text), public.respond_plan(uuid, boolean)
  to authenticated;

alter publication supabase_realtime add table public.plans, public.plan_responses;
