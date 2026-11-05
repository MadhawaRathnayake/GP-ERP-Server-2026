-- hand-written: service quotations are priced by a service charge instead of product lines, and sales quotations can
-- be marked as pre-orders. Added, not recreated (the table has data), so in the database the columns sit after the
-- audit columns, like Role.isSystem; schema.prisma keeps the audit columns last.
--   serviceCharge  service only; the totals are worked out from it (quotations.amounts.ts serviceTotals)
--   serviceTaxRate service only; the VAT percent used for it, copied from the settings like QuotationItem.taxRate
--   isPreOrdered   sales only
-- "A service quotation has a charge and no lines; sales and warranty have lines and no charge" is checked by the API
-- (quotations.types.ts). Only what can't break existing rows is checked here.
ALTER TABLE "Quotation"
  ADD COLUMN "serviceCharge" DECIMAL(14,2),
  ADD COLUMN "serviceTaxRate" DECIMAL(5,2),
  ADD COLUMN "isPreOrdered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_service_charge_check" CHECK (
  "type" = 'service' OR ("serviceCharge" IS NULL AND "serviceTaxRate" IS NULL)
);

ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_pre_order_check" CHECK ("type" = 'sales' OR NOT "isPreOrdered");
