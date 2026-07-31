-- Run this AFTER schema.sql, in the same SQL Editor.
-- Adds columns the AI triage function writes back into.

alter table requests add column if not exists ai_priority text
  check (ai_priority in ('critical', 'high', 'normal'));
alter table requests add column if not exists ai_flags text[] default '{}';
alter table requests add column if not exists ai_summary text;
alter table requests add column if not exists ai_processed_at timestamptz;

-- No RLS changes needed: the Edge Function writes using the service_role key,
-- which bypasses Row Level Security by design — that's what makes it "server-side".
