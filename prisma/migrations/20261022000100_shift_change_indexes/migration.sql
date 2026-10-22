-- Support bounded, time-filtered shift change previews without rewriting records.
CREATE INDEX "EquipmentChange_createdAt_id_idx" ON "EquipmentChange"("createdAt", "id");
CREATE INDEX "OperationEntry_createdAt_id_idx" ON "OperationEntry"("createdAt", "id");
CREATE INDEX "OperationEntry_closedAt_id_idx" ON "OperationEntry"("closedAt", "id");
CREATE INDEX "OperationUpdate_createdAt_id_idx" ON "OperationUpdate"("createdAt", "id");
