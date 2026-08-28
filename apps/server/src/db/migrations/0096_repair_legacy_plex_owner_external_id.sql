-- Plex owner accounts created before a018ab41 (2026-01-07) stored the plex.tv
-- account id in external_id instead of the local PMS id. Sessions report the
-- local id, so the poller never matches the owner account and mints a second
-- one under its own identity on every stream. Merging them fixes it until the
-- next stream, because the merge deletes the account the sessions map to.
--
-- The correct external id is whatever the duplicate holds: a real session
-- produced it. Hardcoding '1' would be wrong on a server whose owner is not
-- local account 1.
--
-- Only folds a duplicate whose identity cannot log in, so a genuine second
-- account is never absorbed. Re-running is a no-op: once the owner row carries
-- the duplicate's external id there is no pair left to match.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.id AS owner_su,
           d.id AS dup_su,
           d.user_id AS dup_user,
           d.external_id AS live_external_id
    FROM server_users o
    JOIN servers s ON s.id = o.server_id AND s.type = 'plex'
    JOIN server_users d
      ON d.server_id = o.server_id
     AND d.user_id <> o.user_id
     AND d.username = o.username
     AND d.is_server_admin = false
     AND d.plex_account_id IS NULL
    WHERE o.is_server_admin = true
      AND o.external_id <> d.external_id
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = d.user_id
          AND (u.password_hash IS NOT NULL
               OR u.plex_account_id IS NOT NULL
               OR u.role IN ('owner', 'admin', 'viewer')
               OR EXISTS (SELECT 1 FROM plex_accounts pa WHERE pa.user_id = u.id)
               OR EXISTS (SELECT 1 FROM auth_accounts aa WHERE aa.user_id = u.id))
      )
  LOOP
    UPDATE sessions         SET server_user_id = r.owner_su WHERE server_user_id = r.dup_su;
    UPDATE automation_runs  SET server_user_id = r.owner_su WHERE server_user_id = r.dup_su;
    UPDATE termination_logs SET server_user_id = r.owner_su WHERE server_user_id = r.dup_su;
    UPDATE automations      SET server_user_id = r.owner_su, updated_at = now()
                            WHERE server_user_id = r.dup_su;

    DELETE FROM server_users WHERE id = r.dup_su;

    DELETE FROM users u
    WHERE u.id = r.dup_user
      AND NOT EXISTS (SELECT 1 FROM server_users su WHERE su.user_id = u.id);

    UPDATE server_users
    SET external_id = r.live_external_id, updated_at = now()
    WHERE id = r.owner_su;

    RAISE NOTICE 'Repaired plex owner account % to external_id %', r.owner_su, r.live_external_id;
  END LOOP;
END $$;
