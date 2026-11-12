-- hand-written: Customer.seaRegistrationNumber and Customer.salesPersonId (a User), both optional. Added, not recreated,
-- so they sit after the audit columns in the database, like Role.isSystem.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "salesPersonId" TEXT,
ADD COLUMN     "seaRegistrationNumber" TEXT;

-- CreateIndex
CREATE INDEX "Customer_salesPersonId_idx" ON "Customer"("salesPersonId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
