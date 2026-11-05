-- hand-written: optional payment terms and delivery location on every quotation type. Added, not recreated (the table
-- has data), so in the database they sit after the audit columns, like Role.isSystem; schema.prisma keeps the audit
-- columns last.
CREATE TYPE "QuotationPaymentTerms" AS ENUM ('cashOnDelivery', 'advancePayment');

ALTER TABLE "Quotation"
  ADD COLUMN "paymentTerms" "QuotationPaymentTerms",
  ADD COLUMN "deliveryLocation" TEXT;
