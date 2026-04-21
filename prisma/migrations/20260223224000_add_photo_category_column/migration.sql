-- Add missing category column to align migration history with schema.prisma
ALTER TABLE "Photo"
ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'food';
