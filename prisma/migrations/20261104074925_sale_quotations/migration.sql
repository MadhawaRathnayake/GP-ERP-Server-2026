-- CreateEnum
CREATE TYPE "UserDropdownSource" AS ENUM ('users', 'roles');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'active', 'accepted', 'declined', 'expired', 'cancelled', 'creditConfirmed', 'paymentConfirmed', 'invoiceCreated');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('none', 'percentage', 'fixed');

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 18;

-- CreateTable
CREATE TABLE "UserDropdown" (
    "id" TEXT NOT NULL,
    "source" "UserDropdownSource" NOT NULL DEFAULT 'roles',
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserDropdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleQuotation" (
    "id" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "salesManagerId" TEXT NOT NULL,
    "quotationDate" DATE NOT NULL,
    "validUntil" DATE,
    "status" "QuotationStatus" NOT NULL DEFAULT 'active',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SaleQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleQuotationItem" (
    "id" SERIAL NOT NULL,
    "quotationId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'none',
    "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SaleQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleQuotation_customerId_idx" ON "SaleQuotation"("customerId");

-- CreateIndex
CREATE INDEX "SaleQuotation_salesManagerId_idx" ON "SaleQuotation"("salesManagerId");

-- CreateIndex
CREATE INDEX "SaleQuotation_status_idx" ON "SaleQuotation"("status");

-- CreateIndex
CREATE INDEX "SaleQuotation_quotationDate_idx" ON "SaleQuotation"("quotationDate");

-- CreateIndex
CREATE INDEX "SaleQuotationItem_quotationId_lineNo_idx" ON "SaleQuotationItem"("quotationId", "lineNo");

-- CreateIndex
CREATE INDEX "SaleQuotationItem_productId_idx" ON "SaleQuotationItem"("productId");

-- AddForeignKey
ALTER TABLE "UserDropdown" ADD CONSTRAINT "UserDropdown_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDropdown" ADD CONSTRAINT "UserDropdown_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotation" ADD CONSTRAINT "SaleQuotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotation" ADD CONSTRAINT "SaleQuotation_salesManagerId_fkey" FOREIGN KEY ("salesManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotation" ADD CONSTRAINT "SaleQuotation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotation" ADD CONSTRAINT "SaleQuotation_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotationItem" ADD CONSTRAINT "SaleQuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SaleQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotationItem" ADD CONSTRAINT "SaleQuotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotationItem" ADD CONSTRAINT "SaleQuotationItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleQuotationItem" ADD CONSTRAINT "SaleQuotationItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "UserDropdown" (added by scripts/migrate.ts)
CREATE TRIGGER "UserDropdown_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "UserDropdown"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "SaleQuotation" (added by scripts/migrate.ts)
CREATE TRIGGER "SaleQuotation_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "SaleQuotation"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "SaleQuotationItem" (added by scripts/migrate.ts)
CREATE TRIGGER "SaleQuotationItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "SaleQuotationItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
