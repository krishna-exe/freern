# Free RN

See which friends are free to call or hang out. Flip a switch, share your user ID, add friends.

- **Switch:** "on" lasts 2 hours, then turns itself off (change it in `set_free`).
- **Times:** you can instead set a from–to time, up to about a day ahead. Friends see it under "Free later" until it starts.
- **Plans:** post a date and time, all your friends see it and can tap "I'm in".
- **Notes:** up to 60 characters under your name for 24 hours. Friends only, separate from the switch.
- **Pictures:** pick from a fixed set of emoji in `src/avatars.js`, which has to match the check on `profiles.avatar`. Otherwise you get initials.
- **Friends:** adding someone sends a request. Availability is visible only once it's accepted.
- **Login:** user ID + password, stored as a synthetic email on a vercel.app domain (see `src/api.js`). No mail is sent and passwords can't be reset.

## Setup

1. Create a Supabase project and run `supabase/migrations/*.sql` against it.
2. Under Auth, turn **off** "Confirm email". This is project-wide, so don't share a project with an app that needs it.
3. Copy `.env.example` to `.env.local` and fill in the URL and anon key.
4. `npm install && npm run dev`

## Tests

`tests/access.mjs` signs up users and tries to break the privacy rules. It leaves those users behind, so use a throwaway project:

    SUPABASE_URL=... SUPABASE_ANON_KEY=... node --experimental-websocket tests/access.mjs
