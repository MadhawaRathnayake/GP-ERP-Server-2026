-- DropIndex
DROP INDEX "Customer_pvNumber_idx";

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "district" DROP NOT NULL,
ALTER COLUMN "province" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Customer_id_idx" ON "Customer"("id");

-- CreateIndex
CREATE INDEX "Customer_code_idx" ON "Customer"("code");
