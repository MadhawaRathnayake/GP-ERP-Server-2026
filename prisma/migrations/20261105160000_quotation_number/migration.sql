-- hand-written: Quotation.quotationNumber, "GPQ-" + at least 7 digits (GPQ-0000001), from next_quotation_number()
-- like next_customer_id(). It has its own sequence, so the numbering can be moved (e.g. past the old system's last GPQ
-- number before go-live) without touching the ids:
--   SELECT setval('quotation_number_seq', <last old number>);
-- Existing quotations get the number of their id (GPQ-12 → GPQ-0000012), so numbers already shown stay the same, and
-- new ones continue after the highest. Added, not recreated (the table has data), so it sits after the audit columns
-- in the database, like Role.isSystem; schema.prisma keeps the audit columns last.
CREATE SEQUENCE quotation_number_seq;

CREATE FUNCTION next_quotation_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'GPQ-' || lpad(n::text, greatest(7, length(n::text)), '0') FROM nextval('quotation_number_seq') AS n
$$;

ALTER TABLE "Quotation" ADD COLUMN "quotationNumber" TEXT;

UPDATE "Quotation" SET "quotationNumber" = 'GPQ-' || lpad("id"::text, greatest(7, length("id"::text)), '0');

-- The next number is one past the highest id (1 when there are no quotations).
SELECT setval('quotation_number_seq', COALESCE(MAX("id"), 0) + 1, false) FROM "Quotation";

ALTER TABLE "Quotation"
  ALTER COLUMN "quotationNumber" SET DEFAULT next_quotation_number(),
  ALTER COLUMN "quotationNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");
