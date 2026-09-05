-- Add the three-way wake mode, preserving what the boolean `silent` meant.
-- A block that was silent becomes SILENT; everything else becomes SIREN.
-- Dropping the column without this step would quietly turn every vibrate-only
-- alarm back into a siren.

ALTER TABLE "TimeTask" ADD COLUMN "wakeMode" TEXT NOT NULL DEFAULT 'SIREN';
ALTER TABLE "TimeTask" ADD COLUMN "voiceText" TEXT;
UPDATE "TimeTask" SET "wakeMode" = CASE WHEN "silent" = 1 THEN 'SILENT' ELSE 'SIREN' END;
ALTER TABLE "TimeTask" DROP COLUMN "silent";

ALTER TABLE "Template" ADD COLUMN "wakeMode" TEXT NOT NULL DEFAULT 'SIREN';
ALTER TABLE "Template" ADD COLUMN "voiceText" TEXT;
UPDATE "Template" SET "wakeMode" = CASE WHEN "silent" = 1 THEN 'SILENT' ELSE 'SIREN' END;
ALTER TABLE "Template" DROP COLUMN "silent";
