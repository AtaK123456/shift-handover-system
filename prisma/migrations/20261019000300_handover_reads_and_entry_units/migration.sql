BEGIN;
-- AlterTable
ALTER TABLE "OperationEntry" ADD COLUMN     "equipmentCode" TEXT;

-- CreateTable
CREATE TABLE "OperationRevision" (
    "id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OperationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverRead" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "HandoverRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandoverRead_userId_shiftId_revision_key" ON "HandoverRead"("userId", "shiftId", "revision");

-- CreateIndex
CREATE INDEX "OperationEntry_equipmentCode_createdAt_idx" ON "OperationEntry"("equipmentCode", "createdAt");

-- AddForeignKey
ALTER TABLE "OperationEntry" ADD CONSTRAINT "OperationEntry_equipmentCode_fkey" FOREIGN KEY ("equipmentCode") REFERENCES "Equipment"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverRead" ADD CONSTRAINT "HandoverRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverRead" ADD CONSTRAINT "HandoverRead_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO "OperationRevision" (id, version) VALUES (1, 0);
COMMIT;
