# Migrations

`ERP-DB` is shared and holds real data. Never run `prisma db push`, `prisma migrate reset` or `npm run db:seed` on it.

## Which way to make a migration

| Change | How |
|---|---|
| New table with a plain id | `npm run db:migrate -- --name <name>` |
| New table with a prefixed id (`SUP00001`) | write the id function by hand at the top of the migration (ADDING-A-FEATURE.md 2.2) |
| Change to an existing table | write or review the SQL by hand, test it on a throwaway database, apply with `npm run db:deploy` |

- `npm run db:migrate` runs `prisma migrate dev`. If Prisma finds that the database and the migrations disagree, it
  **offers to reset the database, deleting all data**. On `ERP-DB` always answer no, and stop.
- To see the SQL Prisma would write without changing anything:
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
- After applying: `npx prisma generate`, so the code sees the new columns.
- Apply a migration together with the code that uses it. Old code reading a dropped or renamed column fails.

## Rules

- **Never edit a migration that's applied.** Prisma checksums them. Write a new one. To see which are applied, look
  at the `_prisma_migrations` table.
- An unapplied migration may still be edited.
- Mark SQL written by hand with `-- hand-written:`.
- Every table needs a `<Table>_notify_change` trigger, or the cache is never cleared for it
  ([automatic.md](automatic.md#cache-invalidation)). `npm run db:migrate` adds it; add it yourself to a hand-written
  migration that creates or recreates a table.
- **New columns on an existing table** go after `isDeleted`, which breaks the "audit columns last" rule. On an empty
  table, drop and recreate it (guard the drop so it stops if rows exist, as in `20261102100000_customer_details`). On a
  table with data, ask first.
- `ALTER COLUMN … DROP NOT NULL` and `RENAME COLUMN` keep a column's position.

## History

| Migration | What it did |
|---|---|
| `20261029000100_init` | First tables, `next_user_id()`, `notify_change()` and the cache triggers |
| `20261029104829_catalogue` | Category and the new Product (recreated), movement tables, `PROD` and `CAT` ids |
| `20261030060000_product_price_cost` | Product price and cost, PriceMovement and CostMovement |
| `20261102090000_is_deleted_and_access_ids` | `isActive` → `isDeleted` everywhere (values flipped), `ROLE` and `PMSN` ids, RolePermission reduced to the two ids |
| `20261102100000_customer_details` | Customer recreated with the real fields and `CUST` ids; refuses to run if Customer has rows |
| `20261103090000_customer_optional_address` | Customer `city`, `district`, `province` optional; index changes |
| `20261103090100_add_suppliers` | Supplier table and `SUP` ids |
| `20261103120000_customer_contacts_and_activity` | Customer recreated with contact person, contact phones, notes and the system-set `isActive`, `isDormant`, `lastInvoiceDate`, `totalInvoices`; refuses to run if Customer has rows |
| `20261103150000_system_role` | `Role.isSystem`, set on Super Admin. Added, not recreated (Role has data), so it sits after the audit columns in the database |
| `20261104074925_sale_quotations` | SaleQuotation, SaleQuotationItem and UserDropdown tables (integer ids for the quotation tables), their enums and cache triggers; `Setting.vatRate` (default 18), added after the audit columns like `Role.isSystem` |
| `20261105090000_product_stock_version` | `Product.stockVersion` (bigint, default 0, added after the audit columns like `Role.isSystem`), `stock_version_seq`, and the live-stock triggers `Product_set_stock_version` and `Product_notify_stock_change` ([automatic.md](automatic.md#live-stock)) |

Add a row for every new migration.
