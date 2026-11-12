-- hand-written: Quotation.confirmedById, the user who set paymentConfirmed or creditConfirmed. Added, not recreated
-- (Quotation may have data), so it sits after the audit columns in the database, like Role.isSystem.

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "confirmedById" TEXT;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
