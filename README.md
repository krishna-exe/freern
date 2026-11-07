# Free RN

See which friends are free to call or hang out. Flip a switch, share your user ID, add friends.

- **Switch:** "on" lasts 2 hours, then turns itself off (change it in `set_free`).
- **Times:** you can instead set a from–to time, up to about a day ahead. Friends see it under "Free later" until it starts.
- **Plans:** post a date and time, all your friends see it and can tap "I'm in".
- **Notes:** up to 60 characters under your name for 24 hours. Friends only, separate from the switch.
- **Catching up:** each friend has a page where either of you can log that you talked, hung out or texted. The latest shows under their name, and turns red after 30 days.
- **Pictures:** pick from a fixed set of emoji in `src/avatars.js`, which has to match the check on `profiles.avatar`. Otherwise you get initials.
- **Friends:** adding someone sends a request. Availability is visible only once it's accepted.
- **Login:** user ID + password, stored as a synthetic email on a vercel.app domain (see `src/api.js`). No mail is sent and passwords can't be reset.

## Setup

1. Create a Supabase project and run `supabase/migrations/*.sql` against it.
2. Under Auth, turn **off** "Confirm email". This is project-wide, so don't share a project with an app that needs it.
3. Copy `.env.example` to `.env.local` and fill in the URL and anon key.
4. `npm install && npm run dev`

Notifications also need `scripts/setup_notifications.py` and both functions in `supabase/functions` deployed. See that script for details.

## Tests

Fast privacy checks, with no account needed:

    node tests/local-backend.mjs supabase/migrations/*.sql
    SKIP_REALTIME=1 SKIP_FUNCTIONS=1 SUPABASE_URL=http://localhost:54399 SUPABASE_ANON_KEY=test node --experimental-websocket tests/access.mjs

Against the real project, including live updates, the browser flow and who gets notified:

    SUPABASE_URL=... SUPABASE_ANON_KEY=... node --experimental-websocket tests/access.mjs
    SENDER_DEPLOYED=1 python3 tests/notifications.py
    npm run dev -- --port 5199 &
    python tests/e2e.py SCREENSHOT_DIR
    python3 scripts/clean_test_users.py

## How it stays cheap as it grows

- Screens load through one call, `get_home`, built from small functions in `private`.
- A change pings only the people it affects, on their own `user:<id>` topic. Pings carry no data.
- Notifications go through a queue, so tapping the switch never waits on a push service.
- Old rows are cleaned up daily by `private.clean_up_old_rows`.
