DO $$
BEGIN
  CREATE TYPE "DailyJournalStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DailyJournalEntry" (
  "id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "photoUrl" TEXT,
  "status" "DailyJournalStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyJournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DailyJournalEntry_status_date_updatedAt_idx" ON "DailyJournalEntry"("status", "date", "updatedAt");
CREATE INDEX IF NOT EXISTS "DailyJournalEntry_date_updatedAt_idx" ON "DailyJournalEntry"("date", "updatedAt");

ALTER TABLE "DailyJournalEntry" ENABLE ROW LEVEL SECURITY;
