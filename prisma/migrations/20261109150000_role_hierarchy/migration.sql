-- hand-written: the role hierarchy and the split of the ADMIN permissions.
--
-- 1. Every role but the system role (Super Admin) gets a managing role, parentRoleId. Existing roles go directly under
--    Super Admin, so until the Super Admin moves roles under other roles, only the Super Admin manages them. Added to a
--    table with data, so the column sits after the audit columns in the database, like Role.isSystem.
-- 2. ADMIN.* is replaced by USERS.*, ROLES.* and SETTINGS.* (src/platform/security/permissions.ts). Roles keep what
--    they could do with users and roles; ADMIN.EDIT_SETTINGS is not carried over, and grants of SETTINGS, DROPDOWNS and
--    APPROVALS are removed: only the Super Admin has them until the Super Admin gives them again.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "parentRoleId" TEXT;

UPDATE "Role"
SET "parentRoleId" = (SELECT "id" FROM "Role" WHERE "isSystem" ORDER BY "createdAt" LIMIT 1)
WHERE NOT "isSystem";

-- CreateIndex
CREATE INDEX "Role_parentRoleId_idx" ON "Role"("parentRoleId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_parentRoleId_fkey" FOREIGN KEY ("parentRoleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- hand-written: only the system role has no managing role (fails here if there are roles but no system role).
ALTER TABLE "Role" ADD CONSTRAINT "Role_parent_check" CHECK ("isSystem" = ("parentRoleId" IS NULL));

-- hand-written: there is one system role (fails here if there are several).
CREATE UNIQUE INDEX "Role_one_system_key" ON "Role"("isSystem") WHERE "isSystem";

-- The permissions-sync plugin creates these at boot, after migrations run, so they're created here to grant them now.
-- Descriptions are refreshed from code at boot.
INSERT INTO "Permission" ("screenCode", "permissionCode", "description")
VALUES
  ('USERS', 'VIEW', 'See users (admin screen)'),
  ('USERS', 'CREATE', 'Create users in the roles under your own role'),
  ('USERS', 'EDIT', 'Edit and deactivate users in the roles under your own role'),
  ('ROLES', 'VIEW', 'See roles and their permissions (admin screen)'),
  ('ROLES', 'CREATE', 'Create roles under your own role'),
  ('ROLES', 'EDIT', 'Edit the roles under your own role, giving them only permissions your own role has')
ON CONFLICT ("screenCode", "permissionCode") DO NOTHING;

-- ADMIN.VIEW → USERS.VIEW + ROLES.VIEW; ADMIN.MANAGE_USERS → USERS.CREATE + EDIT; ADMIN.MANAGE_ROLES → ROLES.CREATE + EDIT.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT old_grant."roleId", new_permission."id"
FROM "RolePermission" AS old_grant
JOIN "Permission" AS old_permission ON old_permission."id" = old_grant."permissionId" AND old_permission."screenCode" = 'ADMIN'
JOIN "Permission" AS new_permission ON (old_permission."permissionCode", new_permission."screenCode", new_permission."permissionCode") IN (
  ('VIEW', 'USERS', 'VIEW'),
  ('VIEW', 'ROLES', 'VIEW'),
  ('MANAGE_USERS', 'USERS', 'CREATE'),
  ('MANAGE_USERS', 'USERS', 'EDIT'),
  ('MANAGE_ROLES', 'ROLES', 'CREATE'),
  ('MANAGE_ROLES', 'ROLES', 'EDIT')
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- The old ADMIN permissions, and every grant of the Super-Admin-only ones (the system role needs no grants).
DELETE FROM "RolePermission"
WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "screenCode" IN ('ADMIN', 'SETTINGS', 'DROPDOWNS', 'APPROVALS'));

DELETE FROM "Permission" WHERE "screenCode" = 'ADMIN';
