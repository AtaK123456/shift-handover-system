CREATE TYPE "WorkStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING');
ALTER TABLE "OperationEntry"
  ADD COLUMN "workStatus" "WorkStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "responsibleTeam" VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN "nextStep" VARCHAR(1000) NOT NULL DEFAULT '',
  ADD COLUMN "workVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "WorkDetailChange" (
  "id" SERIAL PRIMARY KEY,
  "entryId" INTEGER NOT NULL REFERENCES "OperationEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL,
  "workStatus" "WorkStatus" NOT NULL,
  "responsibleTeam" VARCHAR(120) NOT NULL,
  "nextStep" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WorkDetailChange_entryId_version_key" ON "WorkDetailChange"("entryId", "version");
CREATE INDEX "WorkDetailChange_entryId_createdAt_id_idx" ON "WorkDetailChange"("entryId", "createdAt", "id");
CREATE INDEX "WorkDetailChange_createdAt_id_idx" ON "WorkDetailChange"("createdAt", "id");
