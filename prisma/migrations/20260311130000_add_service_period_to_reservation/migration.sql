CREATE TYPE "ServicePeriod" AS ENUM ('LUNCH', 'DINNER');

ALTER TABLE "Reservation"
ADD COLUMN "servicePeriod" "ServicePeriod";

UPDATE "Reservation"
SET "servicePeriod" = CASE
  WHEN "arrivalTime" >= '11:00' AND "arrivalTime" <= '13:30' THEN 'LUNCH'::"ServicePeriod"
  WHEN "arrivalTime" >= '17:30' AND "arrivalTime" <= '20:00' THEN 'DINNER'::"ServicePeriod"
  ELSE NULL
END;

DO $$
DECLARE
  invalid_count INTEGER;
  invalid_ids TEXT;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(string_agg("id", ', ' ORDER BY "id"), '')
  INTO invalid_count, invalid_ids
  FROM "Reservation"
  WHERE "servicePeriod" IS NULL;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Reservation servicePeriod backfill failed. count=%, ids=%',
      invalid_count,
      invalid_ids;
  END IF;
END $$;

ALTER TABLE "Reservation"
ALTER COLUMN "servicePeriod" SET NOT NULL;

DROP INDEX IF EXISTS "Reservation_date_seatType_idx";

CREATE INDEX "Reservation_date_servicePeriod_idx"
ON "Reservation"("date", "servicePeriod");
