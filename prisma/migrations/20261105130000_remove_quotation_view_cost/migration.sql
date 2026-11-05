-- hand-written: QUOTATIONS.VIEW_COST is no longer defined in code (unit cost is shown to everyone who can view
-- quotations). Deleting the permission also deletes its grants (RolePermission cascades). Data only; no schema change.
DELETE FROM "Permission" WHERE "screenCode" = 'QUOTATIONS' AND "permissionCode" = 'VIEW_COST';
