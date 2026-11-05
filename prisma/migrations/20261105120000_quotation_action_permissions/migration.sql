-- hand-written: QUOTATIONS.EDIT used to allow every status change and restoring too. Each of those now has its own
-- permission (src/platform/security/permissions.ts). Every role that had EDIT gets them all, so nobody loses an action
-- until an admin unticks it in the role editor. Data only; no schema change.

-- The permissions-sync plugin creates these at boot, after migrations run, so they're created here to grant them now.
-- Descriptions are refreshed from code at boot.
INSERT INTO "Permission" ("screenCode", "permissionCode", "description")
VALUES
  ('QUOTATIONS', 'RESTORE', 'Restore deleted quotations'),
  ('QUOTATIONS', 'CONFIRM_PAYMENT', 'Confirm payment for quotations'),
  ('QUOTATIONS', 'CONFIRM_CREDIT', 'Confirm credit for quotations'),
  ('QUOTATIONS', 'UNDO_CONFIRMATION', 'Undo a payment or credit confirmation (also needed to reopen one cancelled after it)'),
  ('QUOTATIONS', 'CANCEL', 'Cancel quotations'),
  ('QUOTATIONS', 'REOPEN', 'Reopen cancelled quotations')
ON CONFLICT ("screenCode", "permissionCode") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT grant_edit."roleId", action."id"
FROM "RolePermission" AS grant_edit
JOIN "Permission" AS edit
  ON edit."id" = grant_edit."permissionId" AND edit."screenCode" = 'QUOTATIONS' AND edit."permissionCode" = 'EDIT'
CROSS JOIN "Permission" AS action
WHERE action."screenCode" = 'QUOTATIONS'
  AND action."permissionCode" IN ('RESTORE', 'CONFIRM_PAYMENT', 'CONFIRM_CREDIT', 'UNDO_CONFIRMATION', 'CANCEL', 'REOPEN')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
