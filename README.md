# Raahat — React + Supabase version

Same app, rebuilt: React (Vite) for both frontends, Supabase (Postgres) instead of the
Express + JSON-file backend. The functionality is identical — offline-first SOS capture,
live dashboard — but the architecture is simpler: there's no custom server at all
anymore. Both React apps talk to Supabase directly.

## 1. Set up Supabase (5 minutes)

1. Create a free project at supabase.com.
2. Open **SQL Editor → New query**, paste in the contents of `supabase/schema.sql`,
   and run it. This creates the `requests` table, sets up Row Level Security, and
   turns on Realtime for the table.
3. Go to **Project Settings → API**. You need two values from there: the **Project URL**
   and the **anon / public key**.

## 2. Run the citizen app

```
cd citizen-app
cp .env.example .env.local     # then paste in your Project URL + anon key
npm install
npm run dev
```

## 3. Run the dashboard

```
cd dashboard
cp .env.example .env.local     # same two values
npm install
npm run dev
```

Submit a test SOS in the citizen app, then check it appears on the dashboard within a
second or two — that's Supabase Realtime pushing the new row, not a polling loop.

## What changed from the Express version, and why

**No custom backend.** Supabase auto-generates a REST API and a Realtime feed straight
from the Postgres table, via the `@supabase/supabase-js` client. That's one whole layer
(server.js, routes, manual polling) that doesn't need to exist anymore.

**Dashboard updates are now push, not poll.** The old dashboard asked the server "any
news?" every 4 seconds. This one subscribes once via `supabase.channel(...)`, and
Postgres pushes new/changed rows to it immediately. In a real flood, "instantly" instead
of "up to 4 seconds late" matters.

**Offline logic is unchanged, on purpose.** The IndexedDB queue + `online` event
listener in `citizen-app/src/db.js` and `App.jsx` is the same approach as before, moved
into React state. Supabase is still a cloud API — reaching it always needs *some*
network, so the offline-first pattern (save locally first, sync when signal returns) is
still exactly the right one, regardless of what's on the other end.

**Vite PWA plugin instead of a hand-written service worker.** With React, built files
get hashed names (`index-a3f9c2.js`), so a hand-written cache list from before would
silently go stale on every build. `vite-plugin-pwa` generates the correct cache list
automatically at build time — same outcome (app opens with zero signal), less to
maintain by hand.

## AI auto-triage (new)

Every new SOS now gets read by Claude automatically. It looks at the situation category,
headcount, and the free-text notes, and writes back a priority (`critical` / `high` /
`normal`), a list of flags (medical emergency, elderly, pregnant, etc. — only ones
actually supported by the text), and a one-line summary. The dashboard sorts by this
AI priority when it's available, and shows an "AI: analyzing notes…" badge on a card
until the verdict lands (usually a second or two later, pushed live via Realtime — no
refresh needed).

**Why this matters over the dropdown alone**: a citizen might pick "need supplies" as
the category because that's the closest option, while their notes actually say someone
is having chest pain. The dropdown alone would rank that as low priority. The AI reading
the notes catches it.

**Set it up** (after running `schema.sql`):

1. Run `supabase/migrations_ai_triage.sql` in the SQL Editor — adds the `ai_priority`,
   `ai_flags`, `ai_summary`, `ai_processed_at` columns.
2. Install the Supabase CLI if you haven't: `npm install -g supabase`.
3. Link and deploy the function:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
   supabase functions deploy triage
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — you
   don't set those.)
4. In the Supabase Dashboard, go to **Database → Webhooks → Create a new webhook**:
   - Table: `requests`
   - Events: `Insert`
   - Type: `Supabase Edge Functions`
   - Edge Function: `triage`

   This is the trigger — it's what actually calls the function every time a row is
   inserted. Skipping this step means the function exists but nothing ever calls it.

**Honest status of this piece**: unlike the rest of this project, I could not actually
run this function end-to-end — it needs a live Supabase project, a real Anthropic API
key, and Supabase's Deno runtime, none of which exist in the sandbox I built this in.
Everything else in this repo I built and ran; this one file I wrote carefully and
believe is correct, but you should treat it as needing your own first real test, not
as pre-verified like the rest.

**Cost note**: this calls the Claude API once per SOS request, using the fast/cheap
Haiku model since classification doesn't need deep reasoning. Worth keeping an eye on
usage if this ever gets spammed — see the rate-limiting note below.

## Before this touches a real deployment

The `schema.sql` policies are wide open — any anonymous key holder can read every name,
phone number, and live location in the table, and can mark anything "rescued". That's
fine for a prototype demo, not for a real flood. Before that:

- Add **Supabase Auth** (email/magic-link is enough) for responders, and change the
  `select`/`update` policies in `schema.sql` to `to authenticated` instead of `to anon`.
- Keep the `insert` policy open to `anon` — citizens still shouldn't need an account to
  send an SOS.
- Add basic rate-limiting on inserts (Supabase Edge Functions or a Postgres trigger) so
  the queue can't be spammed.
- Everything else from the original README (SMS fallback, multi-language, LoRa mesh for
  zero-signal zones) still applies unchanged.

## Files

```
supabase/
  schema.sql                 table + RLS policies + realtime — run this first
  migrations_ai_triage.sql   AI columns — run this second
  functions/triage/index.ts  Edge Function: reads notes, writes back priority/flags/summary

citizen-app/           React PWA citizens use
  src/App.jsx           form + SOS button + offline queue UI
  src/db.js             IndexedDB helpers
  src/supabaseClient.js
  vite.config.js        vite-plugin-pwa config (service worker + manifest)

dashboard/              React map + triage queue for responders
  src/App.jsx            Realtime subscription, map, status buttons
  src/supabaseClient.js
```
