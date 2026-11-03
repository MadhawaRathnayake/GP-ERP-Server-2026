# Known issues

Problems found in the code but not fixed yet. Delete an entry when it's fixed.

Last checked: 2026-11-03.

## Suppliers: small bugs in the module

- `suppliers.routes.ts`: `GET /:id` has no `cache: ["Supplier"]`.
- `suppliers.service.ts`: `getSupplier` says "Customer … not found", and `?q=` doesn't search `code` although the
  query's description says it does.

## Comments that don't match the ids

- `schema.prisma`: the comment above `model Customer` says `CUS000001`; ids are `CUST000001`.
- `schema.prisma`: the comment above `model Supplier` says `SUP0001`; the migration now makes `SUP00001`.

## Duplicate indexes

- `@@index([id])` on Customer and Supplier repeats the primary key's index. The migrations that created them are
  applied, so remove the line from both models and drop `Customer_id_idx` and `Supplier_id_idx` in a new migration.
