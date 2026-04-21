CREATE TYPE "ReservationType" AS ENUM ('NORMAL', 'PRIVATE_BLOCK');

ALTER TABLE "Reservation"
ADD COLUMN "reservationType" "ReservationType" NOT NULL DEFAULT 'NORMAL';

CREATE INDEX "Reservation_date_servicePeriod_reservationType_idx"
ON "Reservation"("date", "servicePeriod", "reservationType");
