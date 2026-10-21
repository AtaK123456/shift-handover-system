-- Add display names without changing stable equipment codes or historical relations.
BEGIN;
ALTER TABLE "Equipment" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
UPDATE "Equipment" SET "name" = "code";
COMMIT;
