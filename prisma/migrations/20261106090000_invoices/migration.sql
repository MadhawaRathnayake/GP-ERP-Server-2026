-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'finalized', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('cash', 'credit', 'cheque', 'bankTransfer');

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "invoiceBranchCode" TEXT NOT NULL DEFAULT 'GP01';

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "draftNumber" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "quotationId" INTEGER,
    "quotationStatusBefore" "QuotationStatus",
    "customerId" TEXT NOT NULL,
    "salesManagerId" TEXT NOT NULL,
    "type" "QuotationType" NOT NULL DEFAULT 'sales',
    "repairReceiveNoteId" TEXT,
    "troubleshootId" TEXT,
    "oldInvoiceId" TEXT,
    "oldSerialNumberId" TEXT,
    "productModel" TEXT,
    "paymentTerms" "QuotationPaymentTerms",
    "deliveryLocation" TEXT,
    "paymentMethod" "InvoicePaymentMethod",
    "paymentDetails" TEXT,
    "dueDate" DATE NOT NULL,
    "serviceCharge" DECIMAL(14,2),
    "serviceTaxRate" DECIMAL(5,2),
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "finalizedBy" TEXT,
    "finalizedAt" TIMESTAMPTZ(3),
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
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

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceNumberCounter" (
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InvoiceNumberCounter_pkey" PRIMARY KEY ("kind","period")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_draftNumber_key" ON "Invoice"("draftNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_quotationId_idx" ON "Invoice"("quotationId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_salesManagerId_idx" ON "Invoice"("salesManagerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_lineNo_idx" ON "InvoiceItem"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "InvoiceItem_productId_idx" ON "InvoiceItem"("productId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesManagerId_fkey" FOREIGN KEY ("salesManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_finalizedBy_fkey" FOREIGN KEY ("finalizedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- hand-written: Setting.invoiceBranchCode is added, not recreated (Setting has data), so in the database it sits after
-- the audit columns, like Setting.vatRate; schema.prisma keeps the audit columns last.

-- hand-written: invoice numbers, kept in the old system's format: YY + month (JAN…DEC) + "_" + branch + "_" + the
-- month's sequence, e.g. 26NOV_GP01_14; drafts have their own sequence and end in "-draft" (26NOV_GP01_3-draft).
-- One counter row per kind and month, so a new month starts at 1 without a cron job, and the upsert takes a row lock,
-- so two invoices at once never get the same number. The service passes the day (in the company timezone) and the
-- branch code (Setting.invoiceBranchCode).
CREATE FUNCTION next_invoice_number(counter_kind text, day date, branch text) RETURNS text LANGUAGE sql AS $$
  INSERT INTO "InvoiceNumberCounter" ("kind", "period", "value")
  VALUES (counter_kind, to_char(day, 'YYMON'), 1)
  ON CONFLICT ("kind", "period") DO UPDATE SET "value" = "InvoiceNumberCounter"."value" + 1, "modifiedAt" = now()
  RETURNING "period" || '_' || branch || '_' || "value" || CASE WHEN counter_kind = 'draft' THEN '-draft' ELSE '' END
$$;

-- hand-written: one invoice that isn't cancelled per quotation.
CREATE UNIQUE INDEX "Invoice_quotationId_live_key" ON "Invoice"("quotationId") WHERE "status" <> 'cancelled';

-- hand-written: the same per-type rules as Quotation (quotations.types.ts); the API checks them too.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_type_fields_check" CHECK (
  ("type" = 'service' OR "repairReceiveNoteId" IS NULL)
  AND ("type" = 'warranty' OR ("troubleshootId" IS NULL AND "productModel" IS NULL))
  AND ("type" IN ('service', 'warranty') OR ("oldInvoiceId" IS NULL AND "oldSerialNumberId" IS NULL))
);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_service_charge_check" CHECK (
  "type" = 'service' OR ("serviceCharge" IS NULL AND "serviceTaxRate" IS NULL)
);

-- Payment details only go with a cheque or a bank transfer.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_payment_details_check" CHECK (
  "paymentDetails" IS NULL OR "paymentMethod" IN ('cheque', 'bankTransfer')
);

-- A draft has no final number yet; a finalized invoice has one. A cancelled one keeps what it had.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_check" CHECK (
  ("status" <> 'draft' OR "invoiceNumber" IS NULL) AND ("status" <> 'finalized' OR "invoiceNumber" IS NOT NULL)
);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write (as scripts/migrate.ts adds them)
CREATE TRIGGER "Invoice_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Invoice"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

CREATE TRIGGER "InvoiceItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "InvoiceItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

CREATE TRIGGER "InvoiceNumberCounter_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "InvoiceNumberCounter"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
