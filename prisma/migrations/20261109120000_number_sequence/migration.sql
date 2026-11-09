-- hand-written: InvoiceNumberCounter becomes NumberSequence, the document number sequences of every screen (not only
-- invoices). Renamed, not recreated, so the invoice counters keep their values: restarting them would give numbers
-- that existing invoices already have. "kind" becomes "code", which names the sequence: draft → invoice.draft,
-- final → invoice.final.

-- AlterTable
ALTER TABLE "InvoiceNumberCounter" RENAME TO "NumberSequence";
ALTER TABLE "NumberSequence" RENAME CONSTRAINT "InvoiceNumberCounter_pkey" TO "NumberSequence_pkey";
ALTER TABLE "NumberSequence" RENAME COLUMN "kind" TO "code";
ALTER TRIGGER "InvoiceNumberCounter_notify_change" ON "NumberSequence" RENAME TO "NumberSequence_notify_change";

UPDATE "NumberSequence" SET "code" = 'invoice.' || "code";

-- hand-written: the next value of a sequence, starting at 1. code names the sequence (e.g. invoice.final); period
-- (e.g. 26NOV) and branch (Role.branchCode) give each month and branch its own count, '' for a sequence that doesn't
-- restart or isn't per branch. The upsert takes a row lock, so two callers never get the same value; called inside
-- the transaction that saves the document, a rollback gives the value back.
CREATE FUNCTION next_sequence_value(seq_code text, seq_period text, seq_branch text) RETURNS integer LANGUAGE sql AS $$
  INSERT INTO "NumberSequence" ("code", "period", "branch", "value")
  VALUES (seq_code, seq_period, seq_branch, 1)
  ON CONFLICT ("code", "period", "branch") DO UPDATE SET "value" = "NumberSequence"."value" + 1, "modifiedAt" = now()
  RETURNING "value"
$$;

-- hand-written: the same invoice numbers as before (20261106120000_role_branch_code), from NumberSequence:
-- 26NOV_GP01_14, drafts 26NOV_GP01_3-draft.
CREATE OR REPLACE FUNCTION next_invoice_number(counter_kind text, day date, branch text) RETURNS text LANGUAGE sql AS $$
  SELECT to_char(day, 'YYMON') || '_' || $3 || '_'
    || next_sequence_value('invoice.' || counter_kind, to_char(day, 'YYMON'), $3)
    || CASE WHEN counter_kind = 'draft' THEN '-draft' ELSE '' END
$$;
