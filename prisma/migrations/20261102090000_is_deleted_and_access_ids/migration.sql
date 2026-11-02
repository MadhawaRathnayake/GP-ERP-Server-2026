-- hand-written: this whole migration. Prisma would generate DROP + ADD COLUMN here, losing the data, so existing rows
-- are converted in place instead. ALTER and RENAME keep each column's position, so the audit columns stay last.

-- ─── isActive → isDeleted ────────────────────────────────────────────────────
-- The meaning flips, so the values flip too: isActive = true becomes isDeleted = false.
-- RolePermission isn't here: it loses the column altogether below.

ALTER TABLE "Setting" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "Setting" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "Setting" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "User" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "User" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "User" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "Role" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "Role" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "Role" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "Permission" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "Permission" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "Permission" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "Category" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "Category" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "Category" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "Product" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "Product" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "Product" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "PriceMovement" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "PriceMovement" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "PriceMovement" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "CostMovement" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "CostMovement" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "CostMovement" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "StockMovement" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "StockMovement" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "StockMovement" SET "isDeleted" = NOT "isDeleted";

ALTER TABLE "Customer" RENAME COLUMN "isActive" TO "isDeleted";
ALTER TABLE "Customer" ALTER COLUMN "isDeleted" SET DEFAULT false;
UPDATE "Customer" SET "isDeleted" = NOT "isDeleted";

-- ─── RolePermission becomes a plain mapping: roleId + permissionId only ──────

ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_createdBy_fkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_modifiedBy_fkey";
ALTER TABLE "RolePermission"
  DROP COLUMN "createdBy",
  DROP COLUMN "createdAt",
  DROP COLUMN "modifiedBy",
  DROP COLUMN "modifiedAt",
  DROP COLUMN "isActive";

-- ─── Role ids → ROLE0001, Permission ids → PMSN0001 ──────────────────────────
-- Same id generator pattern as next_user_id() in the init migration: they widen instead of truncating, and numbers are
-- never reused.

CREATE SEQUENCE "role_number_seq" AS bigint;

CREATE FUNCTION next_role_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'ROLE' || lpad(n::text, greatest(4, length(n::text)), '0') FROM nextval('role_number_seq') AS n
$$;

CREATE SEQUENCE "permission_number_seq" AS bigint;

CREATE FUNCTION next_permission_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'PMSN' || lpad(n::text, greatest(4, length(n::text)), '0') FROM nextval('permission_number_seq') AS n
$$;

-- The foreign keys can't stay while the types and values on both sides change. They're added back below.
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

ALTER TABLE "Role" ALTER COLUMN "id" TYPE TEXT USING "id"::text;
ALTER TABLE "User" ALTER COLUMN "roleId" TYPE TEXT USING "roleId"::text;
ALTER TABLE "Permission" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Permission" ALTER COLUMN "id" TYPE TEXT USING "id"::text;
DROP SEQUENCE "Permission_id_seq";
ALTER TABLE "RolePermission" ALTER COLUMN "roleId" TYPE TEXT USING "roleId"::text;
ALTER TABLE "RolePermission" ALTER COLUMN "permissionId" TYPE TEXT USING "permissionId"::text;

-- Give every existing row its new id, oldest first, and point the references at it. Taking the numbers from the
-- sequences means new rows continue after the last one.
CREATE TEMP TABLE role_ids AS
  SELECT "id" AS old_id, next_role_id() AS new_id FROM (SELECT "id" FROM "Role" ORDER BY "createdAt", "id") AS roles;

CREATE TEMP TABLE permission_ids AS
  SELECT "id" AS old_id, next_permission_id() AS new_id FROM (SELECT "id" FROM "Permission" ORDER BY "id"::int) AS permissions;

UPDATE "Role" SET "id" = role_ids.new_id FROM role_ids WHERE "Role"."id" = role_ids.old_id;
UPDATE "User" SET "roleId" = role_ids.new_id FROM role_ids WHERE "User"."roleId" = role_ids.old_id;
UPDATE "RolePermission" SET "roleId" = role_ids.new_id FROM role_ids WHERE "RolePermission"."roleId" = role_ids.old_id;
UPDATE "Permission" SET "id" = permission_ids.new_id FROM permission_ids WHERE "Permission"."id" = permission_ids.old_id;
UPDATE "RolePermission" SET "permissionId" = permission_ids.new_id FROM permission_ids WHERE "RolePermission"."permissionId" = permission_ids.old_id;

DROP TABLE role_ids;
DROP TABLE permission_ids;

ALTER TABLE "Role" ALTER COLUMN "id" SET DEFAULT next_role_id();
ALTER TABLE "Permission" ALTER COLUMN "id" SET DEFAULT next_permission_id();

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- The primary key (roleId, permissionId) already finds a role's permissions; this one finds the roles that have a permission.
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
