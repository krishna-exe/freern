-- A picture chosen from a fixed set (see src/avatars.js). Null shows initials.
alter table public.profiles add column avatar text check (avatar in ('🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐨', '🐙', '🦉', '🐧', '🐢', '🦄', '🐶', '🐱', '🌵', '🍕', '☕', '🎧', '🎮', '🚀'));

grant update (avatar) on public.profiles to authenticated;

alter publication supabase_realtime add table public.profiles;
