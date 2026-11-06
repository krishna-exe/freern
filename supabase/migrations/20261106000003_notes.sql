-- A short note friends see under your name. It lives on statuses, not profiles,
-- so pending requests can't read it.
alter table public.statuses
  add column note text check (char_length(note) <= 60),
  add column note_until timestamptz;

create function public.set_note(body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := nullif(trim(coalesce(body, '')), '');
begin
  if char_length(cleaned) > 60 then
    raise exception 'Keep your note to 60 characters.';
  end if;
  update statuses
  set note = cleaned,
      note_until = case when cleaned is null then null else now() + interval '24 hours' end
  where user_id = auth.uid();
end $$;

revoke all on function public.set_note(text) from public, anon;
grant execute on function public.set_note(text) to authenticated;
