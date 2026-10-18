BEGIN;
SET LOCAL lock_timeout = '10s';
-- Stop writes until both the preflight check and index creation are complete.
LOCK TABLE "Shift" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT "userId" FROM "Shift" WHERE "status" = 'ACTIVE'
    GROUP BY "userId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple ACTIVE shifts exist for a user. Review and resolve duplicates before retrying this migration; no records were changed.';
  END IF;
END $$;
CREATE UNIQUE INDEX "Shift_one_active_per_user"
ON "Shift" ("userId") WHERE "status" = 'ACTIVE';
COMMIT;
