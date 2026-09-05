-- Stable handles so an agent can address blocks and rules by name rather than
-- reading ids first, and so re-applying a plan edits instead of duplicating.
ALTER TABLE "TimeTask" ADD COLUMN "planKey" TEXT;
CREATE INDEX "TimeTask_planKey_idx" ON "TimeTask"("planKey");

ALTER TABLE "Template" ADD COLUMN "key" TEXT;
CREATE UNIQUE INDEX "Template_key_key" ON "Template"("key");
