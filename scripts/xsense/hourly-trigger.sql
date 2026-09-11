-- ============================================================
--  Reliable hourly X-Sense trigger  (Supabase pg_cron -> GitHub)
--
--  WHY: GitHub's own scheduled cron is best-effort and was dropping ~85% of
--  runs, leaving multi-hour gaps. Supabase's pg_cron runs inside Postgres on a
--  real clock, so it fires every hour reliably and calls the GitHub workflow's
--  "workflow_dispatch" API to run the collector.
--
--  RUN THIS ONCE in the `blvdgardens4h` project's SQL Editor
--  (Supabase dashboard -> SQL Editor -> New query -> paste -> Run).
--  Replace PASTE_YOUR_GITHUB_TOKEN_HERE first (keep the single quotes).
-- ============================================================

-- 1) Enable the scheduler + outbound-HTTP extensions (safe to re-run).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Store the GitHub token in Vault (encrypted, not in plain SQL). Create it,
--    or update it if you're re-running with a new token.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'github_xsense_pat') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'github_xsense_pat'),
      'PASTE_YOUR_GITHUB_TOKEN_HERE'
    );
  else
    perform vault.create_secret('PASTE_YOUR_GITHUB_TOKEN_HERE', 'github_xsense_pat');
  end if;
end $$;

-- 3) Schedule the trigger at the top of every hour (UTC). Re-running replaces it.
select cron.schedule(
  'xsense-hourly-trigger',
  '0 * * * *',
  $$
    select net.http_post(
      url     := 'https://api.github.com/repos/gongrealty/57throadpha/actions/workflows/xsense-collect.yml/dispatches',
      headers := jsonb_build_object(
        'Authorization',        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_xsense_pat'),
        'Accept',               'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent',           'supabase-pg-cron',
        'Content-Type',         'application/json'
      ),
      body    := jsonb_build_object('ref', 'master')
    );
  $$
);

-- ---- verify -------------------------------------------------
-- The scheduled job exists and is active:
--   select jobname, schedule, active from cron.job where jobname = 'xsense-hourly-trigger';
-- Its run history (after the next hour):
--   select jobname, status, start_time from cron.job_run_details order by start_time desc limit 5;
-- And a GitHub Actions run should appear (triggered via API) within the hour.
