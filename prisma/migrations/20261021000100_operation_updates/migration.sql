CREATE TABLE "OperationUpdate" (
  "id" SERIAL NOT NULL,
  "entryId" INTEGER NOT NULL,
  "authorId" INTEGER NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "requestId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationUpdate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationUpdate_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OperationUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperationUpdate_authorId_requestId_key" ON "OperationUpdate"("authorId", "requestId");
CREATE INDEX "OperationUpdate_entryId_createdAt_id_idx" ON "OperationUpdate"("entryId", "createdAt", "id");
