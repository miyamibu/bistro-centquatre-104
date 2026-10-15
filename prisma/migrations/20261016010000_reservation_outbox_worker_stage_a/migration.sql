-- Additive Worker Stage A, including validation of a separately applied Stage A.
-- No ledger, claim/reset guard, sender switch, role, or data changes.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog;

LOCK TABLE public."ReservationEmailOutbox" IN ACCESS EXCLUSIVE MODE;

DO $stage_a$
DECLARE
  labels text[];
  target_table oid := to_regclass('public."ReservationEmailOutbox"');
  target_type oid := to_regtype('public."ReservationEmailOutboxStatus"');
  column_row record;
  target_index oid := to_regclass('public."ReservationEmailOutbox_status_dispatchUnknownAt_idx"');
BEGIN
  IF target_table IS NULL OR target_type IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = target_table AND relkind = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = target_table
       AND attname = 'status' AND atttypid = target_type AND NOT attisdropped) THEN
    RAISE EXCEPTION 'STAGE_A_TARGET_MISMATCH';
  END IF;
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder) INTO labels
    FROM pg_enum WHERE enumtypid = target_type;
  IF labels IS DISTINCT FROM ARRAY['PENDING','PROCESSING','SENT','SKIPPED','DEAD_LETTER']::text[]
     AND labels IS DISTINCT FROM ARRAY['PENDING','PROCESSING','SENT','SKIPPED','DEAD_LETTER',
       'DISPATCH_CLAIMED','RETRY_NOT_SENT','SENDING','OUTCOME_UNKNOWN','RECONCILE_REQUIRED']::text[] THEN
    RAISE EXCEPTION 'STAGE_A_ENUM_MISMATCH';
  END IF;
  SELECT atttypid, atttypmod, attnotnull, atthasdef, attidentity, attgenerated
    INTO column_row FROM pg_attribute
    WHERE attrelid = target_table AND attname = 'dispatchUnknownAt' AND NOT attisdropped;
  IF FOUND AND (column_row.atttypid <> 'timestamp without time zone'::regtype
       OR column_row.atttypmod <> 3 OR column_row.attnotnull OR column_row.atthasdef
       OR column_row.attidentity <> '' OR column_row.attgenerated <> '') THEN
    RAISE EXCEPTION 'STAGE_A_COLUMN_MISMATCH';
  END IF;
  IF target_index IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indexrelid = target_index AND i.indrelid = target_table
      AND i.indisvalid AND i.indisready AND NOT i.indisunique AND NOT i.indisprimary
      AND pg_get_indexdef(i.indexrelid) = 'CREATE INDEX "ReservationEmailOutbox_status_dispatchUnknownAt_idx" ON public."ReservationEmailOutbox" USING btree (status, "dispatchUnknownAt")'
  ) THEN
    RAISE EXCEPTION 'STAGE_A_INDEX_MISMATCH';
  END IF;
END
$stage_a$;

ALTER TYPE public."ReservationEmailOutboxStatus" ADD VALUE IF NOT EXISTS 'DISPATCH_CLAIMED';
ALTER TYPE public."ReservationEmailOutboxStatus" ADD VALUE IF NOT EXISTS 'RETRY_NOT_SENT';
ALTER TYPE public."ReservationEmailOutboxStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE public."ReservationEmailOutboxStatus" ADD VALUE IF NOT EXISTS 'OUTCOME_UNKNOWN';
ALTER TYPE public."ReservationEmailOutboxStatus" ADD VALUE IF NOT EXISTS 'RECONCILE_REQUIRED';
ALTER TABLE public."ReservationEmailOutbox" ADD COLUMN IF NOT EXISTS "dispatchUnknownAt" timestamp(3);
CREATE INDEX IF NOT EXISTS "ReservationEmailOutbox_status_dispatchUnknownAt_idx"
  ON public."ReservationEmailOutbox" (status, "dispatchUnknownAt");
DO $stage_a_post$
DECLARE
  labels text[];
  target_table oid := to_regclass('public."ReservationEmailOutbox"');
  target_type oid := to_regtype('public."ReservationEmailOutboxStatus"');
  column_row record;
  target_index oid := to_regclass('public."ReservationEmailOutbox_status_dispatchUnknownAt_idx"');
BEGIN
  IF target_table IS NULL OR target_type IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = target_table AND relkind = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = target_table
       AND attname = 'status' AND atttypid = target_type AND NOT attisdropped) THEN
    RAISE EXCEPTION 'STAGE_A_TARGET_MISMATCH';
  END IF;
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder) INTO labels
    FROM pg_enum WHERE enumtypid = target_type;
  IF labels IS DISTINCT FROM ARRAY['PENDING','PROCESSING','SENT','SKIPPED','DEAD_LETTER',
       'DISPATCH_CLAIMED','RETRY_NOT_SENT','SENDING','OUTCOME_UNKNOWN','RECONCILE_REQUIRED']::text[] THEN
    RAISE EXCEPTION 'STAGE_A_ENUM_MISMATCH';
  END IF;
  SELECT atttypid, atttypmod, attnotnull, atthasdef, attidentity, attgenerated
    INTO column_row FROM pg_attribute
    WHERE attrelid = target_table AND attname = 'dispatchUnknownAt' AND NOT attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAGE_A_COLUMN_MISSING';
  END IF;
  IF (column_row.atttypid <> 'timestamp without time zone'::regtype
       OR column_row.atttypmod <> 3 OR column_row.attnotnull OR column_row.atthasdef
       OR column_row.attidentity <> '' OR column_row.attgenerated <> '') THEN
    RAISE EXCEPTION 'STAGE_A_COLUMN_MISMATCH';
  END IF;
  IF target_index IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indexrelid = target_index AND i.indrelid = target_table
      AND i.indisvalid AND i.indisready AND NOT i.indisunique AND NOT i.indisprimary
      AND pg_get_indexdef(i.indexrelid) = 'CREATE INDEX "ReservationEmailOutbox_status_dispatchUnknownAt_idx" ON public."ReservationEmailOutbox" USING btree (status, "dispatchUnknownAt")'
  ) THEN
    RAISE EXCEPTION 'STAGE_A_INDEX_MISMATCH';
  END IF;
END
$stage_a_post$;
COMMIT;
