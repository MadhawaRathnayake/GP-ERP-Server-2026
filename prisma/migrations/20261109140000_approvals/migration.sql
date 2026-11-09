-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" SERIAL NOT NULL,
    "screen" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Approval_screen_documentId_idx" ON "Approval"("screen", "documentId");

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- hand-written: a rejection always says why; an automatic decision (approval not required) is always an approval.
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reason_check" CHECK ("decision" <> 'rejected' OR "reason" IS NOT NULL);
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_automatic_check" CHECK (NOT "isAutomatic" OR "decision" = 'approved');

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write (as scripts/migrate.ts adds them)
CREATE TRIGGER "ApprovalRule_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "ApprovalRule"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

CREATE TRIGGER "Approval_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Approval"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
