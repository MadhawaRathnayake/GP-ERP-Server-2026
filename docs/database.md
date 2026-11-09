# Database: who fills what

## Columns nobody has to set

When a row is created, these columns are filled even though the service doesn't send them:

| Column | Filled by | Value |
|---|---|---|
| `id` | the database (`@default(dbgenerated("next_<table>_id()"))` or `autoincrement()`) | see [ids](#ids) |
| `createdAt` | the database (`@default(now())` → `DEFAULT CURRENT_TIMESTAMP`) | the time of the insert, stored in UTC |
| `isDeleted` | the database (`@default(false)`) | `false` |
| `modifiedAt`, `modifiedBy` | nobody on create | `NULL` until the first update |
| other `@default(…)` columns | the database | e.g. `Customer.phones` → `[]`, `Product.price` → `0`, `Role.isSystem` → `false` |

The row Prisma returns from `create` already contains them, so the API response shows the generated id and
`createdAt`.

## Columns the service must set

| Column | When | How |
|---|---|---|
| `createdBy` | create | `createdBy: actor.id` |
| `modifiedBy`, `modifiedAt` | every update, including soft delete and restore | `modifiedBy: actor.id, modifiedAt: new Date()` |

`actor` comes from `actorOf(req)` in the route. `NULL` in `createdBy`/`modifiedBy` means the system wrote the row
(boot sync, seed). The exception is `User.createdBy`, which is required.

## Columns the system sets later

| Column | Set by | Meaning |
|---|---|---|
| `Customer.isActive` | invoices / a schedule (not built yet) | last invoice less than 6 months ago (default `true`) |
| `Customer.isDormant` | invoices / a schedule (not built yet) | last invoice over 18 months ago (default `false`) |
| `Customer.lastInvoiceDate` | invoices (not built yet) | `NULL` until the first invoice |
| `Customer.totalInvoices` | invoices (not built yet) | `0` until the first invoice |
| `Role.isSystem` | migration `20261103150000_system_role` and the seed | `true` only on Super Admin ([automatic.md](automatic.md#permissions)) |

None of them is in a request schema, so clients can't send them. The app only shows them.

## Columns clients can never send

zod removes every key a request schema doesn't list. The create and update schemas never list `id`, `createdBy`,
`createdAt`, `modifiedBy`, `modifiedAt` or the system-set columns above, so a client sending them has no effect. Update schemas list `isDeleted`, so
`PATCH { isDeleted: false }` restores a row.

## Ids

| Table | Format | Generator | Example |
|---|---|---|---|
| User | `USER` + 5 digits | `next_user_id()` | `USER00001` |
| Role | `ROLE` + 4 digits | `next_role_id()` | `ROLE0001` |
| Permission | `PMSN` + 4 digits | `next_permission_id()` | `PMSN0001` |
| Category | `CAT` + 4 digits | `next_category_id()` | `CAT0001` |
| Product | `PROD` + 6 digits | `next_product_id()` | `PROD000001` |
| Customer | `CUST` + 6 digits | `next_customer_id()` | `CUST000001` |
| Supplier | `SUP` + 5 digits | `next_supplier_id()` | `SUP00001` |
| PriceMovement, CostMovement, StockMovement | integer | `autoincrement()` | `1` |
| Quotation, QuotationItem | integer | `autoincrement()` | `1` |
| Invoice, InvoiceItem | integer | `autoincrement()` | `1` |
| Session | SHA-256 of the cookie id | the app | |
| Setting | always `1` | | |
| UserDropdown | the dropdown's code, e.g. `SALES_MANAGER` | `USER_DROPDOWNS` in `modules/dropdowns/dropdowns.ts` | `SALES_MANAGER` |
| ApprovalRule | the screen's code, e.g. `INTERNAL_REQUISITIONS` | `APPROVAL_SCREENS` in `modules/approvals/approvals.ts` | `INTERNAL_REQUISITIONS` |
| Approval | integer | `autoincrement()` | `1` |
| RolePermission | `roleId` + `permissionId` together | | |

- The generators are SQL functions written by hand in a migration, each with its own sequence (`<table>_number_seq`).
  Search `prisma/migrations` for `CREATE FUNCTION next_` to find one.
- **They widen, they don't wrap:** after `CAT9999` comes `CAT10000`.
- **Numbers are never reused.** A failed insert uses one up, so gaps are normal. Don't use these ids where the law
  needs numbers without gaps (e.g. invoice numbers): give such documents their own number column.
- **They sort as text**, so `CAT10000` sorts before `CAT9999`. Sort lists by `createdAt` or a name, not by id.
- Each module checks the format of `:id` with its own regex (e.g. `/^CUST\d{6,}$/` in `customers.schema.ts`). Keep
  the regex in step with the function. The shared `idParams` in `#http/fields.js` is for uuid ids only.

## Soft delete

- `DELETE` routes set `isDeleted = true`; rows are never removed, so their history stays.
- Lists hide deleted rows unless `?includeDeleted=true`. A detail route still returns a deleted row.
- `PATCH { isDeleted: false }` restores a row.
- Deleted rows keep their values, so a `@unique` column (e.g. `Product.sku`) stays taken after a delete.

## Other rules

- **Audit columns last**, in this order: `createdBy`, `createdAt`, `modifiedBy`, `modifiedAt`, `isDeleted`. Only
  `Session` and `RolePermission` go without them. `test/schema.test.ts` fails otherwise. It checks `schema.prisma`, not
  the database: in the database, `Role.isSystem` and `Role.branchCode` sit after them because they were added to a table with data.
- **Time:** `@db.Timestamptz(3)`, stored in UTC. The frontend shows it in the company timezone (`Setting.timezone`).
- **Money:** `Decimal @db.Decimal(14, 2)`, sent as a JSON number through `money` from `#http/fields.js`.
- **`passwordHash` is never loaded** unless a query asks for it (`omit: { passwordHash: false }`), set globally in
  `src/platform/core/db.ts`.
- **Errors from Prisma** become HTTP errors on their own: unique value taken (P2002) → 409, foreign key broken
  (P2003) → 409, row not found on update (P2025) → 404 (`src/platform/http/error-handler.plugin.ts`).
- **Indexes:** the primary key already has one; don't add `@@index([id])`. Add one per exact filter or lookup, per
  foreign key column, and for a list's sort column. Skip columns with only a few values (`isDeleted`, enums).
