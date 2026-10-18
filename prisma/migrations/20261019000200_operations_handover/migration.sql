BEGIN;
-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('EVENT', 'NOTE', 'VALVE', 'ATTENTION', 'TASK');

-- CreateEnum
CREATE TYPE "EntryPriority" AS ENUM ('NORMAL', 'HIGH');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "scheduledEnd" TEXT,
ADD COLUMN     "scheduledStart" TEXT,
ADD COLUMN     "shiftDate" TEXT;

-- CreateTable
CREATE TABLE "Equipment" (
    "code" TEXT NOT NULL,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3),
    "updatedById" INTEGER,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "EquipmentChange" (
    "id" SERIAL NOT NULL,
    "equipmentCode" TEXT NOT NULL,
    "fromStatus" "EquipmentStatus" NOT NULL,
    "toStatus" "EquipmentStatus" NOT NULL,
    "note" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationEntry" (
    "id" SERIAL NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "priority" "EntryPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" INTEGER NOT NULL,
    "shiftId" INTEGER,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "closeNote" TEXT,

    CONSTRAINT "OperationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationPhoto" (
    "id" TEXT NOT NULL,
    "entryId" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationEntry_closedAt_kind_createdAt_idx" ON "OperationEntry"("closedAt", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentChange" ADD CONSTRAINT "EquipmentChange_equipmentCode_fkey" FOREIGN KEY ("equipmentCode") REFERENCES "Equipment"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentChange" ADD CONSTRAINT "EquipmentChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEntry" ADD CONSTRAINT "OperationEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEntry" ADD CONSTRAINT "OperationEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEntry" ADD CONSTRAINT "OperationEntry_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationPhoto" ADD CONSTRAINT "OperationPhoto_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "Equipment" (code) VALUES ('GT1'), ('GT2'), ('ST');
COMMIT;
