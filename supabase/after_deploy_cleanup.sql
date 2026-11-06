-- Run once the app using get_home and broadcast is live, not before: the previous
-- version of the site still depends on all of this.
alter publication supabase_realtime drop table
  public.statuses, public.friendships, public.plans, public.plan_responses, public.profiles;

drop function public.respond_plan(uuid, boolean);
