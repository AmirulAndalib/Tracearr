-- Migration: Change duration/progress columns from integer to bigint
-- Required for Jellystat imports that may have large tick values exceeding int32 max
--
-- This migration handles both cases:
-- 1. Fresh databases where sessions is not yet a hypertable (just alter columns)
-- 2. Existing databases where sessions IS a hypertable with compression enabled
--
-- For hypertables with compression, special handling is required:
-- - Drop continuous aggregates that reference these columns
-- - Remove compression policy, decompress chunks, disable compression
-- - Alter column types
-- - Re-enable compression with same settings, re-add compression policy
-- Note: Continuous aggregates will be recreated automatically on server startup

DO $$
DECLARE
    is_hypertable BOOLEAN := false;
    has_timescaledb BOOLEAN := false;
    job_id_var INTEGER;
    chunk_record RECORD;
    decompressed_count INTEGER := 0;
    compress_after_interval INTERVAL;
BEGIN
    -- First check if TimescaleDB extension is installed
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) INTO has_timescaledb;

    -- Only check for hypertable if TimescaleDB exists
    IF has_timescaledb THEN
        SELECT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_name = 'sessions'
        ) INTO is_hypertable;
    END IF;

    IF is_hypertable THEN
        RAISE NOTICE 'sessions is a hypertable, performing full migration with compression handling';

        -- Step 1: Drop continuous aggregates that reference duration_ms
        -- (they will be recreated on server startup by initTimescaleDB)
        DROP MATERIALIZED VIEW IF EXISTS daily_plays_by_user CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS daily_plays_by_server CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS daily_stats_summary CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS hourly_concurrent_streams CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS daily_play_patterns CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS hourly_play_patterns CASCADE;
        RAISE NOTICE 'Dropped continuous aggregates';

        -- Step 2: Get compression policy info and remove it
        SELECT job_id, (config->>'compress_after')::interval INTO job_id_var, compress_after_interval
        FROM timescaledb_information.jobs
        WHERE hypertable_name = 'sessions'
        AND proc_name = 'policy_compression'
        LIMIT 1;

        IF job_id_var IS NOT NULL THEN
            PERFORM remove_compression_policy('sessions', if_exists => true);
            RAISE NOTICE 'Removed compression policy (was job %)', job_id_var;
        END IF;

        -- Step 3: Decompress all compressed chunks
        FOR chunk_record IN
            SELECT chunk_schema, chunk_name
            FROM timescaledb_information.chunks
            WHERE hypertable_name = 'sessions'
            AND is_compressed = true
        LOOP
            EXECUTE format('SELECT decompress_chunk(%L)', chunk_record.chunk_schema || '.' || chunk_record.chunk_name);
            decompressed_count := decompressed_count + 1;
        END LOOP;

        IF decompressed_count > 0 THEN
            RAISE NOTICE 'Decompressed % chunks', decompressed_count;
        END IF;

        -- Step 4: Disable compression on the hypertable
        ALTER TABLE sessions SET (timescaledb.compress = false);
        RAISE NOTICE 'Disabled compression on sessions hypertable';

        -- Step 5: Alter column types from integer to bigint
        ALTER TABLE sessions ALTER COLUMN duration_ms SET DATA TYPE bigint;
        ALTER TABLE sessions ALTER COLUMN total_duration_ms SET DATA TYPE bigint;
        ALTER TABLE sessions ALTER COLUMN progress_ms SET DATA TYPE bigint;
        RAISE NOTICE 'Altered column types to bigint';

        -- Step 6: Re-enable compression with same settings
        ALTER TABLE sessions SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'server_user_id, server_id'
        );
        RAISE NOTICE 'Re-enabled compression on sessions hypertable';

        -- Step 7: Re-add compression policy (compress chunks older than 7 days)
        PERFORM add_compression_policy('sessions', COALESCE(compress_after_interval, INTERVAL '7 days'));
        RAISE NOTICE 'Re-added compression policy';

        RAISE NOTICE 'Migration complete. Continuous aggregates will be recreated on server startup.';
    ELSE
        RAISE NOTICE 'sessions is not a hypertable (fresh database), performing simple column type change';

        -- Simple case: just alter the column types
        ALTER TABLE sessions ALTER COLUMN duration_ms SET DATA TYPE bigint;
        ALTER TABLE sessions ALTER COLUMN total_duration_ms SET DATA TYPE bigint;
        ALTER TABLE sessions ALTER COLUMN progress_ms SET DATA TYPE bigint;

        RAISE NOTICE 'Column types changed to bigint';
    END IF;

END $$;
