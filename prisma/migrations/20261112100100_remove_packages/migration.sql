-- hand-written: data only. Packages leave the products (docs/plans/serial-numbers.md §3.4); a packages module comes
-- later. The old system's package products ("System Package with Panels") and both package categories are soft-deleted,
-- so the imported quotations that sold them keep their lines. modifiedBy stays NULL: changed by the system.
UPDATE "Product"
SET "isDeleted" = true, "modifiedAt" = now()
WHERE "categoryId" IN (SELECT "id" FROM "Category" WHERE "name" IN ('System Package with Panels', 'System Packages'))
  AND NOT "isDeleted";

UPDATE "Category"
SET "isDeleted" = true, "modifiedAt" = now()
WHERE "name" IN ('System Package with Panels', 'System Packages')
  AND NOT "isDeleted";
