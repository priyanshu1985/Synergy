-- Run this in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query)
-- before running either app.

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  local_id text unique not null,       -- generated on-device; lets us de-duplicate retries
  name text default 'Not given',
  phone text default 'Not given',
  people_count text default '1',
  situation text not null,             -- stranded | injured | supplies | evacuate
  notes text default '',
  lat double precision,
  lng double precision,
  accuracy double precision,
  captured_at bigint not null,         -- ms epoch, set on the phone at the moment of press
  received_at timestamptz not null default now(),
  updated_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'dispatched', 'rescued'))
);

-- Row Level Security: OFF by default in Postgres means "no access at all" once RLS is
-- enabled, so we write explicit policies for exactly what each app needs.
alter table requests enable row level security;

-- Citizen app: anyone (no login) can submit a request. This has to stay open —
-- you can't require a stranded person to sign up for an account first.
create policy "Anyone can insert requests"
  on requests for insert
  to anon
  with check (true);

-- Dashboard: reads the live list. Wide open for now so the prototype works with zero
-- auth setup. SEE THE README — this must be restricted to logged-in responders before
-- this touches a real disaster, otherwise anyone with your Supabase URL can read every
-- name, phone number and live location in the table.
create policy "Anyone can read requests"
  on requests for select
  to anon
  using (true);

-- Dashboard: marking dispatched/rescued. Same caveat as above — lock this down to an
-- authenticated "responder" role before production use.
create policy "Anyone can update requests"
  on requests for update
  to anon
  using (true);

-- Turns on Supabase Realtime for this table, so the dashboard gets pushed new/updated
-- rows instantly instead of having to poll.
alter publication supabase_realtime add table requests;
