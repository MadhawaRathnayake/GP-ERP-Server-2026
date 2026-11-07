-- hand-written: the invoice branch code moves from the company settings to each role, and each branch gets its own
-- invoice number counter. Existing roles and counters take the branch code the settings had.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "branchCode" TEXT NOT NULL DEFAULT 'GP01';

UPDATE "Role" SET "branchCode" = (SELECT "invoiceBranchCode" FROM "Setting" WHERE "id" = 1)
WHERE EXISTS (SELECT 1 FROM "Setting" WHERE "id" = 1);

-- AlterTable
ALTER TABLE "InvoiceNumberCounter" ADD COLUMN     "branch" TEXT NOT NULL DEFAULT 'GP01';

UPDATE "InvoiceNumberCounter" SET "branch" = (SELECT "invoiceBranchCode" FROM "Setting" WHERE "id" = 1)
WHERE EXISTS (SELECT 1 FROM "Setting" WHERE "id" = 1);

ALTER TABLE "InvoiceNumberCounter" ALTER COLUMN "branch" DROP DEFAULT;

ALTER TABLE "InvoiceNumberCounter" DROP CONSTRAINT "InvoiceNumberCounter_pkey",
ADD CONSTRAINT "InvoiceNumberCounter_pkey" PRIMARY KEY ("kind", "period", "branch");

-- AlterTable
ALTER TABLE "Setting" DROP COLUMN "invoiceBranchCode";

-- hand-written: the same numbers as before (20261106090000_invoices), but counted per branch: 26NOV_GP01_14 and
-- 26NOV_GP02_1 come from different counter rows. The service passes the branch code of the user's role. The parameter
-- keeps its name (CREATE OR REPLACE can't rename it), so it's $3 here: "branch" is now also a column.
CREATE OR REPLACE FUNCTION next_invoice_number(counter_kind text, day date, branch text) RETURNS text LANGUAGE sql AS $$
  INSERT INTO "InvoiceNumberCounter" ("kind", "period", "branch", "value")
  VALUES (counter_kind, to_char(day, 'YYMON'), $3, 1)
  ON CONFLICT ("kind", "period", "branch") DO UPDATE SET "value" = "InvoiceNumberCounter"."value" + 1, "modifiedAt" = now()
  RETURNING "period" || '_' || "branch" || '_' || "value" || CASE WHEN counter_kind = 'draft' THEN '-draft' ELSE '' END
$$;
