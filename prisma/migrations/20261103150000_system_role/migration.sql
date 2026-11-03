-- hand-written: marks Super Admin as the system role (see model Role in schema.prisma).
-- Role holds data, so the column is added rather than the table recreated: in the database it sits after the audit
-- columns. Nothing reads columns by position, and schema.prisma (which test/schema.test.ts checks) keeps them last.
ALTER TABLE "Role" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Role" SET "isSystem" = true WHERE "name" = 'Super Admin';
