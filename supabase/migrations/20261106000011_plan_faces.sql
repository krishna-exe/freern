-- Plans show the faces of who's in, so they need more than names. Same privacy as
-- plan_names: only people in your own circle.
create function private.plan_people(plan uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.person_json(p) order by p.name), '[]'::jsonb)
  from plan_responses r
  join private.circle() as circle(id) on circle.id = r.user_id
  join profiles p on p.id = r.user_id
  where r.plan_id = plan and r.going
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
    'inPeople', private.plan_people(pl.id),
    'inNames', private.plan_names(pl.id, true),
    'outNames', private.plan_names(pl.id, false)
  ) order by pl.starts_at), '[]'::jsonb)
  from private.circle() as circle(id)
  join plans pl on pl.user_id = circle.id
  join profiles h on h.id = pl.user_id
  where pl.starts_at > now() - interval '2 hours' and private.can_see_plan(pl)
$$;
