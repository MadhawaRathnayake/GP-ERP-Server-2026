# Adding a feature, end to end (example: Suppliers)

This walks through every file you touch to add a new entity, from the database table to the sidebar link. It uses
**Suppliers** as the example: a table, a CRUD API, its own permissions and a screen in the frontend.

Follow the steps in order. Each step names the exact file. The short version is the [checklist](#checklist) at the end.

- Backend repo: `GP-ERP-Server` (this folder). Frontend repo: `../GP-ERP-Client`.
- The code below is the real `src/modules/suppliers/` module, with the fixes listed in `docs/known-issues.md` applied.
  Copy it for a paginated list with search, create, edit, soft delete and restore. `src/modules/categories/` shows a
  small unpaginated list and a business rule on delete.
- What the database fills by itself, migrations, caching and logging in more detail: `docs/`.

## Contents

1. [Overview: what you touch](#1-overview-what-you-touch)
2. [Database: model and migration](#2-database-model-and-migration)
3. [Permissions](#3-permissions)
4. [API schema (zod)](#4-api-schema-zod)
5. [Service (business logic)](#5-service-business-logic)
6. [Routes: API, authentication and authorization](#6-routes-api-authentication-and-authorization)
7. [Errors](#7-errors)
8. [Caching](#8-caching)
9. [Tests](#9-tests)
10. [Docs and verification](#10-docs-and-verification)
11. [Frontend](#11-frontend)
12. [After deploying: grant the permissions](#12-after-deploying-grant-the-permissions)
13. [What you never touch](#13-what-you-never-touch)
14. [Checklist](#checklist)

---

## 1. Overview: what you touch

| # | Area | File | New / edit |
|---|---|---|---|
| 1 | Table | `prisma/schema.prisma` | edit: add `model Supplier` + 2 lines on `User` |
| 2 | Migration | `prisma/migrations/<timestamp>_add_suppliers/migration.sql` | new (`--create-only`, plus the hand-written id function and trigger) |
| 3 | Permissions | `src/platform/security/permissions.ts` | edit: add a `SUPPLIERS` group |
| 4 | Request / response shapes | `src/modules/suppliers/suppliers.schema.ts` | new |
| 5 | Business logic | `src/modules/suppliers/suppliers.service.ts` | new |
| 6 | HTTP endpoints | `src/modules/suppliers/suppliers.routes.ts` | new |
| 7 | Feature errors (optional) | `src/modules/suppliers/suppliers.errors.ts` | new, only if needed |
| 8 | Integration test | `src/modules/suppliers/suppliers.int.test.ts` | new |
| 9 | Access matrix | `test/app.test.ts` | edit: add every new route |
| 10 | Docs | `README.md`, `ARCHITECTURE.md` | edit if behaviour or structure changed |
| 11 | Frontend permission keys | `../GP-ERP-Client/src/app/auth.ts` | edit: `PermissionKey` |
| 12 | Frontend data | `../GP-ERP-Client/src/pages/Suppliers/types.ts`, `api.ts` | new |
| 13 | Frontend pages | `../GP-ERP-Client/src/pages/Suppliers/SuppliersPage.tsx` (+ dialog / detail / edit) | new |
| 14 | Frontend route | `../GP-ERP-Client/src/router.tsx` | edit |
| 15 | Sidebar link | `../GP-ERP-Client/src/app/layout/navigation.ts` | edit |

How one request flows through these files:

```
Browser ──HTTP──▶ /api/v1/suppliers/…
                    │
  platform/security/auth.plugin.ts    session cookie → user → permission check  (401 / 403)
  platform/cache/route-cache.plugin   GET served from Redis if cached           (x-cache: HIT)
                    │
  modules/suppliers/suppliers.routes.ts    validates with suppliers.schema.ts   (400)
  modules/suppliers/suppliers.service.ts   business rules, Prisma queries       (404 / 409)
                    │
  PostgreSQL "Supplier" table ── notify_change trigger ──▶ cache invalidated
```

---

## 2. Database: model and migration

### 2.1 The model: `prisma/schema.prisma`

Add the model in its section (e.g. under a new `// ─── Purchases ───` heading). Rules:

- The model name is the table name. Don't use `@@map`.
- Timestamps are `@db.Timestamptz(3)`. Money is `Decimal @db.Decimal(14, 2)`.
- **The audit columns go last, in this exact order:** `createdBy`, `createdAt`, `modifiedBy`, `modifiedAt`,
  `isDeleted`. `test/schema.test.ts` fails otherwise. Copy them, with their relations, from an existing model. Only
  `Session` and `RolePermission` go without them.

```prisma
// ─── Purchases ───────────────────────────────────────────────────────────────

// Ids are SUP00001, SUP00002, … (next_supplier_id(), hand-written SQL like next_user_id()).
model Supplier {
  id          String    @id @default(dbgenerated("next_supplier_id()"))
  code        String
  name        String
  phones      String[]  @default([])
  email       String?
  houseNumber String?
  street      String?
  city        String?
  district    String?
  province    String?
  country     String
  vatNumber   String?
  tinNumber   String?
  pvNumber    String?
  creator     User?     @relation("SupplierCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  createdBy   String?
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  modifier    User?     @relation("SupplierModifiedBy", fields: [modifiedBy], references: [id], onDelete: SetNull)
  modifiedBy  String?
  modifiedAt  DateTime? @db.Timestamptz(3)
  isDeleted   Boolean   @default(false)

  @@index([name])
  @@index([code])
  @@index([phones], type: Gin)
  @@index([vatNumber])
}
```

Field choices:
- **Required** columns have no `?`: here `code`, `name` and `country`. Everything else is optional.
- **Defaults** (`@default(…)`) are filled by the database when a row is created; so are `id`, `createdAt` and
  `isDeleted` (`docs/database.md`).
- **Text** for anything with letters, hyphens or leading zeros (codes, tax and phone numbers). `String[]` for a simple
  list such as phone numbers. An `enum` when there are a few fixed values (see `CustomerType`).
- **`@unique`** only if two rows may never share the value, deleted rows included (they keep their values).
  `code` isn't unique here.
- **Indexes:** one per exact lookup or filter and one for the list's sort column (`name`). The primary key already
  has one, so never add `@@index([id])`. Skip columns with only a few values (`isDeleted`, enums). The GIN index lets
  `phones: { has: "+94…" }` find a supplier by one exact number.

Then add the other side of the two audit relations to `model User`, in the "Rows this user created or last modified"
block. Prisma won't validate the schema without them:

```prisma
  createdSuppliers        Supplier[]       @relation("SupplierCreatedBy")
  modifiedSuppliers       Supplier[]       @relation("SupplierModifiedBy")
```

A foreign key to another table (e.g. `Product.categoryId`) follows the same pattern: a scalar column plus a relation
field, and the list field on the other model.

```prisma
  categoryId String
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Restrict)
```

### 2.2 The migration

Check the schema first with `npx prisma validate`.

**Plain uuid id** (`id String @id @default(uuid()) @db.Uuid`): one command does everything.

```bash
npm run db:migrate -- --name add_suppliers
```

It runs `scripts/migrate.ts`, which:
1. generates the SQL from `schema.prisma`,
2. appends the `Supplier_notify_change` cache trigger,
3. applies it and regenerates the Prisma client (`src/generated/`).

**Prefixed id like `SUP00001`**: the id function must exist before the table, so add it by hand first.

```bash
npx prisma migrate dev --create-only --name add_suppliers   # writes migration.sql, doesn't apply it
```

Paste this at the top of the new `prisma/migrations/<timestamp>_add_suppliers/migration.sql` (the number in
`greatest(5, …)` is how many digits the id has at least):

```sql
-- hand-written: supplier id generator, same pattern as next_user_id() in the init migration.
-- SUP00001 …; it widens instead of truncating, and numbers are never reused.
CREATE SEQUENCE "supplier_number_seq" AS bigint;

CREATE FUNCTION next_supplier_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'SUP' || lpad(n::text, greatest(5, length(n::text)), '0') FROM nextval('supplier_number_seq') AS n
$$;
```

Then add the cache trigger at the end of the same file, so the table never exists without it:

```sql
-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Supplier" (added by scripts/migrate.ts)
CREATE TRIGGER "Supplier_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Supplier"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
```

Apply it with `npm run db:deploy`, then `npx prisma generate`. The real file is
`prisma/migrations/20261103090100_add_suppliers/migration.sql`.

**`prisma migrate dev` can reset the database.** `npm run db:migrate` and `--create-only` both run it. If Prisma finds
that the database and the migration files disagree, it offers to reset the database, which deletes all data. On the
shared `ERP-DB` always answer no and stop. To see the SQL Prisma would write without touching anything:
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.

**Migration rules**
- **Never edit a migration that has already been applied.** Prisma checksums them. Write a new one.
- Mark any SQL you write by hand with `-- hand-written:`.
- Never use `prisma db push`, and never reset or drop the shared `ERP-DB`.
- **Adding columns to an existing table:** Postgres appends new columns after `isDeleted`, which breaks the
  "audit columns last" rule. On an empty table, drop and recreate it in the migration (see
  `20261029104829_catalogue`). On a table with data, ask first.

---

## 3. Permissions

**File:** `src/platform/security/permissions.ts`

**Every feature gets its own permission group.** Never reuse another screen's codes, even for a related feature.
Otherwise an admin can't grant it separately. Add only the actions the feature has:

```ts
export const PERMISSIONS = {
  …
  SUPPLIERS: {
    VIEW: "View suppliers",
    CREATE: "Create suppliers",
    EDIT: "Edit suppliers",
    DELETE: "Delete suppliers",
  },
  …
}
```

What happens then, automatically:
- `PermissionKey` gets `"SUPPLIERS.VIEW" | "SUPPLIERS.CREATE" | …`, so a typo on a route is a compile error.
- At the next server start, `permissions-sync.plugin.ts` creates the `Permission` rows (`screenCode = SUPPLIERS`,
  `permissionCode = VIEW`, …).
- `GET /api/v1/permissions` returns them, and they appear in the frontend role editor, grouped by screen.
- **Only Super Admin has them yet**: the system role always has every permission. Other roles need them ticked. See
  [step 12](#12-after-deploying-grant-the-permissions).

Editing `permissions.ts` for a feature is a normal part of every feature. It isn't a platform change that needs
approval.

---

## 4. API schema (zod)

**File:** `src/modules/suppliers/suppliers.schema.ts` (new)

This file defines what the API accepts and returns. Fastify validates every request against it (400 on bad input),
shapes every response with it, and `/docs` is generated from it.

```ts
import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"

const supplierId = z.string().regex(/^SUP\d{5,}$/, "Must be a supplier id like SUP00001")

export const supplierIdParams = z.object({ id: supplierId })

// Response: every column the client may see, audit columns included.
export const supplier = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  phones: z.array(z.string()),
  email: z.string().nullable(),
  houseNumber: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string(),
  vatNumber: z.string().nullable(),
  tinNumber: z.string().nullable(),
  pvNumber: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const supplierPage = pageResult(supplier) // { data: Supplier[], total }

export const listSuppliersQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on code, name or email"),
  includeDeleted: z.stringbool().default(false).describe("Include deleted suppliers"),
})

const phone = z.string().trim().regex(/^\+?\d{7,15}$/, "Must be a phone number like +94771234567, with no spaces")

// Fields a client may send. Never the id or the audit columns: those are set by the server.
const supplierFields = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  phones: z.array(phone).max(10),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
  houseNumber: z.string().trim().min(1).max(50).nullable(),
  street: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100).nullable(),
  district: z.string().trim().min(1).max(100).nullable(),
  province: z.string().trim().min(1).max(100).nullable(),
  country: z.string().trim().min(1).max(100),
  vatNumber: z.string().trim().regex(/^\d{9}-\d{4}$/, "Must be a VAT number like 109860522-7000").nullable(),
  tinNumber: z.string().trim().regex(/^\d{9}$/, "Must be a TIN number like 109860522").nullable(),
  pvNumber: z.string().trim().regex(/^PV-\d+$/, "Must be a PV number like PV-00300617").nullable(),
})

export const createSupplierBody = supplierFields.extend({
  phones: supplierFields.shape.phones.default([]),
  email: supplierFields.shape.email.default(null),
  houseNumber: supplierFields.shape.houseNumber.default(null),
  street: supplierFields.shape.street.default(null),
  city: supplierFields.shape.city.default(null),
  district: supplierFields.shape.district.default(null),
  province: supplierFields.shape.province.default(null),
  vatNumber: supplierFields.shape.vatNumber.default(null),
  tinNumber: supplierFields.shape.tinNumber.default(null),
  pvNumber: supplierFields.shape.pvNumber.default(null),
})

// Built from the fields WITHOUT defaults. `createSupplierBody.partial()` would keep the defaults, so a PATCH that only
// renames a supplier would reset its phones and address to empty.
export const updateSupplierBody = supplierFields
  .extend({ isDeleted: z.boolean().describe("true = deleted: hidden from lists by default") })
  .partial()

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuery>
export type CreateSupplierBody = z.infer<typeof createSupplierBody>
export type UpdateSupplierBody = z.infer<typeof updateSupplierBody>
```

Field helpers (`src/platform/http/fields.ts`, `pagination.ts`):

| Need | Use |
|---|---|
| Money (`Decimal` column) | `money`: JSON number in and out, Prisma `Decimal` inside |
| Date in a response | `z.date()`: sent as an ISO string |
| uuid `:id` param | `idParams` from `#http/fields.js` |
| Prefixed `:id` param | your own regex, as above |
| Paginated list | `pageQuery.extend({…})` for the query, `pageResult(item)` for the response |
| Small list (no paging) | `z.array(item)` (see `categories.schema.ts`) |

---

## 5. Service (business logic)

**File:** `src/modules/suppliers/suppliers.service.ts` (new)

Plain functions. They take plain arguments plus an `Actor` (who is acting), return Prisma rows as they are, and never
touch `request`/`reply`. The zod response schema does the shaping.

```ts
import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateSupplierBody, ListSuppliersQuery, UpdateSupplierBody } from "./suppliers.schema.js"

export function listSuppliers({ q, includeDeleted, ...page }: ListSuppliersQuery) {
  const where: Prisma.SupplierWhereInput = {
    ...(q && {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(!includeDeleted && { isDeleted: false }),
  }
  return paginate(
    page,
    (args) => db.supplier.findMany({ where, orderBy: { name: "asc" }, ...args }),
    () => db.supplier.count({ where }),
  )
}

export async function getSupplier(id: string) {
  const supplier = await db.supplier.findUnique({ where: { id } })
  if (!supplier) throw new NotFoundError("Supplier", id)
  return supplier
}

export function createSupplier(data: CreateSupplierBody, actor: Actor) {
  return db.supplier.create({ data: { ...data, createdBy: actor.id } })
}

// Unknown id → Prisma P2025 → 404 (platform/http/error-handler.plugin.ts).
export function updateSupplier(id: string, data: UpdateSupplierBody, actor: Actor) {
  return db.supplier.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
}

/** Suppliers are never deleted: they're deactivated, so their history stays. `PATCH { isDeleted: false }` restores one. */
export async function deleteSupplier(id: string, actor: Actor) {
  await updateSupplier(id, { isDeleted: true }, actor)
}
```

Rules:
- **Audit columns:** set `createdBy: actor.id` on create, and `modifiedBy: actor.id, modifiedAt: new Date()` on every
  update. Never take them from the request body. `id`, `createdAt`, `isDeleted` and every `@default` column are
  filled by the database, and the row `create` returns already has them.
- **Delete is soft:** `isDeleted = true`. Lists hide deleted rows unless `includeDeleted=true`.
- **Business rules belong here**, e.g. "can't delete a category that active products use" (see
  `categories.service.ts`).
- **Don't import another module.** A service may query any table through `db`, but `modules/a` never imports
  `modules/b` (ARCHITECTURE.md → "Events between modules").

---

## 6. Routes: API, authentication and authorization

**File:** `src/modules/suppliers/suppliers.routes.ts` (new)

**Routes are discovered automatically.** `app.ts` mounts every `src/modules/<folder>/<folder>.routes.ts` at
`/api/v1/<folder>`, so this file becomes `/api/v1/suppliers`. Don't edit `app.ts`.

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { createSupplierBody, listSuppliersQuery, supplier, supplierIdParams, supplierPage, updateSupplierBody } from "./suppliers.schema.js"
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from "./suppliers.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listSuppliersQuery, response: { 200: supplierPage } },
      config: { permission: "SUPPLIERS.VIEW", cache: ["Supplier"] },
    },
    (req) => listSuppliers(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: supplierIdParams, response: { 200: supplier } },
      config: { permission: "SUPPLIERS.VIEW", cache: ["Supplier"] },
    },
    (req) => getSupplier(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createSupplierBody, response: { 201: supplier } },
      config: { permission: "SUPPLIERS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createSupplier(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: supplierIdParams, body: updateSupplierBody, response: { 200: supplier } },
      config: { permission: "SUPPLIERS.EDIT" },
    },
    (req) => updateSupplier(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: supplierIdParams },
      config: { permission: "SUPPLIERS.DELETE" },
    },
    async (req, reply) => {
      await deleteSupplier(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
```

The resulting API:

| Method | Path | Body / query | Permission | Success |
|---|---|---|---|---|
| GET | `/api/v1/suppliers` | `?page&limit&q&includeDeleted` | `SUPPLIERS.VIEW` | 200 `{ data, total }` |
| GET | `/api/v1/suppliers/:id` | | `SUPPLIERS.VIEW` | 200 supplier |
| POST | `/api/v1/suppliers` | `createSupplierBody` | `SUPPLIERS.CREATE` | 201 supplier |
| PATCH | `/api/v1/suppliers/:id` | `updateSupplierBody` | `SUPPLIERS.EDIT` | 200 supplier |
| DELETE | `/api/v1/suppliers/:id` | | `SUPPLIERS.DELETE` | 204 |

### How authentication works (nothing to write)

`src/platform/security/auth.plugin.ts` runs before every route under `/api/v1`:

1. It reads the `sid` cookie. With no cookie, or an expired or unknown session, the request gets **401
   `UNAUTHENTICATED`**, and the frontend sends the user to `/login`.
2. It loads the user and their role's permissions (`current-user.ts`, cached in Redis). A deactivated user gets 401.
3. If the route has `config.permission` and the user's role doesn't grant it, the request gets **403 `FORBIDDEN`** with
   `details: { permission }`.
4. It sets `req.user` (the signed-in user) and `actorOf(req)` (`{ id, sessionId }`, which you pass to services).

### How authorization is declared on a route

| `config` on the route | Who can call it |
|---|---|
| `{ public: true }` | anyone, without a session (only login, logout, health) |
| nothing | any signed-in user |
| `{ permission: "SUPPLIERS.CREATE" }` | signed-in users whose role has that permission |

Use `public` only for routes that must work without signing in. Give every route of a feature a permission from its
own group. A route can name one permission.

---

## 7. Errors

**Throw, never format.** `platform/http/error-handler.plugin.ts` turns every error into
`{ error: { code, message, details?, requestId } }`.

| Situation | What to do | Response |
|---|---|---|
| Body / query / params invalid | nothing: zod does it | 400 `VALIDATION_ERROR` |
| Record not found | `throw new NotFoundError("Supplier", id)` | 404 `NOT_FOUND` |
| Unknown id on `update` | nothing: Prisma P2025 | 404 |
| Duplicate unique value | nothing: Prisma P2002 | 409 `CONFLICT` |
| Business rule broken | `throw new ConflictError("…")` / `BadRequestError("…")` | 409 / 400 |
| Something specific to suppliers | a subclass in `suppliers.errors.ts` (see `users.errors.ts`) | your code |

All the base classes are in `src/platform/http/errors.ts`.

```ts
// src/modules/suppliers/suppliers.errors.ts (only if you need one)
import { AppError } from "#http/errors.js"

export class SupplierHasOpenOrdersError extends AppError {
  constructor(id: string) {
    super(409, "SUPPLIER_HAS_OPEN_ORDERS", `Supplier ${id} has open purchase orders`)
  }
}
```

---

## 8. Caching

On every **GET** route, `config: { cache: ["Supplier"] }` lists **every table the response reads**. If a response also
joins `User`, list `["Supplier", "User"]`.

- Responses are cached in Redis. The header `x-cache: HIT/MISS` shows which one you got.
- Any write to a listed table, from the app or straight SQL, fires the table's `notify_change` trigger (added by
  `npm run db:migrate`), which clears those entries.
- Access is checked before a cached response is served.
- Writes (POST/PATCH/DELETE) don't need a cache config.
- Outside routes, use `cache.remember()` from `#cache/cache.js`.

If Redis is down, everything still works, just uncached.

---

## 9. Tests

| Test | File | What to do |
|---|---|---|
| Audit columns order | `test/schema.test.ts` | nothing: it checks every model automatically |
| Route mounted | `test/app.test.ts` → "mounts every module" | add `"/api/v1/suppliers"` to the list |
| Access matrix | `test/app.test.ts` → "%s %s requires %s" | **add every new route** with its permission (below) |
| Schema unit test (optional) | `src/modules/suppliers/suppliers.schema.test.ts` | defaults, and that PATCH doesn't reset fields |
| Integration | `src/modules/suppliers/suppliers.int.test.ts` | real DB + Redis (copy this file) |

Access matrix rows (`test/app.test.ts`); declare `const aSupplierId = "SUP00002"` next to `aCategoryId`. The id must
match the route's id format, or the request fails validation (400) instead of the permission check (403):

```ts
    ["GET", "/api/v1/suppliers", "SUPPLIERS.VIEW"],
    ["GET", `/api/v1/suppliers/${aSupplierId}`, "SUPPLIERS.VIEW"],
    ["POST", "/api/v1/suppliers", "SUPPLIERS.CREATE"],
    ["PATCH", `/api/v1/suppliers/${aSupplierId}`, "SUPPLIERS.EDIT"],
    ["DELETE", `/api/v1/suppliers/${aSupplierId}`, "SUPPLIERS.DELETE"],
```

Integration test: `src/modules/suppliers/suppliers.int.test.ts` is the one to copy. Its setup and cleanup:

```ts
const stamp = Date.now()
const code = `TEST-${stamp}` // test rows' codes start with TEST-, so afterAll can remove them
const name = `Test Supplier ${stamp}` // unique, so ?q= finds only this test's supplier
const body = { code, name, country: "Sri Lanka" }

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["SUPPLIERS.VIEW", "SUPPLIERS.CREATE", "SUPPLIERS.EDIT", "SUPPLIERS.DELETE"])
  viewer = await signIn(app, ["SUPPLIERS.VIEW"])
})

afterAll(async () => {
  await db.supplier.deleteMany({ where: { code: { startsWith: "TEST-" } } })
  await cleanupTestUsers()
  await app.close()
})
```

What it checks, one `it` each:

| Test | Expects |
|---|---|
| create | 201, a `SUP…` id, defaults (`city: null`), `createdBy` = the user |
| create without `SUPPLIERS.CREATE` | 403 |
| badly formatted VAT number | 400 |
| list, search, cache | `?q=` finds it; the second request is `x-cache: HIT`; after a PATCH it's `MISS` with the new name, and the PATCH left the other fields alone |
| delete and restore | 204; hidden from the list; shown with `includeDeleted=true`; `PATCH { isDeleted: false }` restores |
| bad ids | 404 for an unknown id, 400 for a malformed one |

A test that edits and then reads a cached route waits for the cache to be cleared first:
`const changed = waitForChange("Supplier")` before the write, `await changed` after it.

`npm test` runs the unit tests (no DB needed). `npm run test:int` writes to the shared `ERP-DB`, so ask before running
it.

---

## 10. Docs and verification

- `README.md`: add a line if the feature has behaviour others need to know (e.g. soft delete, id format).
- `ARCHITECTURE.md`: add the module name to the `modules/` box in the diagram.

All four must pass before the feature is done:

```bash
npm run typecheck
npm run lint        # also enforces the layering and import rules
npm test
npm run build
```

Then open `http://localhost:3000/docs`, log in via `POST /api/v1/auth/login`, and try the routes.

**Imports:** use `#core/…`, `#http/…`, `#security/…`, `#generated/…` across folders and `./x.js` inside the module.
Never use `../`, and always write `.js`.

---

## 11. Frontend

Repo `../GP-ERP-Client`. Read its `AGENTS.md`, plus the skills `.claude/skills/new-page` and
`.claude/skills/add-feature-data`. Copy `src/pages/Categories/` (dialog CRUD) or `src/pages/Products/` (separate
create, detail and edit pages).

### 11.1 Permission keys: `src/app/auth.ts`

Add the backend's new keys to the `PermissionKey` union. If the backend doesn't define them yet, stop: don't reuse
another feature's keys.

```ts
  | "SUPPLIERS.VIEW"
  | "SUPPLIERS.CREATE"
  | "SUPPLIERS.EDIT"
  | "SUPPLIERS.DELETE"
```

### 11.2 Types: `src/pages/Suppliers/types.ts`

Mirror the API response. Dates arrive as ISO strings and money as numbers.

```ts
export interface Supplier {
  // "SUP00001"
  id: string
  code: string
  name: string
  // e.g. ["+94112345678"]
  phones: string[]
  email: string | null
  houseNumber: string | null
  street: string | null
  city: string | null
  district: string | null
  province: string | null
  country: string
  // e.g. "109860522-7000", "109860522", "PV-00300617"
  vatNumber: string | null
  tinNumber: string | null
  pvNumber: string | null
  createdBy: string | null
  createdAt: string
  modifiedBy: string | null
  modifiedAt: string | null
  // true = deleted; it can be restored.
  isDeleted: boolean
}

// On create, phones defaults to [] and the other optional fields to null.
export type NewSupplier = Pick<Supplier, "code" | "name" | "country"> &
  Partial<
    Pick<
      Supplier,
      "phones" | "email" | "houseNumber" | "street" | "city" | "district" | "province" | "vatNumber" | "tinNumber" | "pvNumber"
    >
  >

export type SupplierUpdate = Partial<NewSupplier & { isDeleted: boolean }> & { id: string }
```

### 11.3 API calls and hooks: `src/pages/Suppliers/api.ts`

Use only the shared `http` instance, which sends the session cookie and turns errors into `ApiError`. Pages use the
hooks and never call axios. The list is paginated on the server, so `fetchAll` reads every page and `DataGrid` pages
in the browser.

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { fetchAll, http } from "@/lib/http"

import type { NewSupplier, Supplier, SupplierUpdate } from "./types"

export const fetchSuppliers = () => fetchAll<Supplier>("/suppliers")

export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers })
}

export function useCreateSupplier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: NewSupplier) => (await http.post<Supplier>("/suppliers", body)).data,
    onSuccess: (supplier) => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] })
      toast.success(`Created supplier "${supplier.name}"`)
    },
    onError: (error) => toast.error(`Could not create supplier: ${error.message}`),
  })
}

// useUpdateSupplier → http.patch(`/suppliers/${id}`, changes)
// useDeleteSupplier → http.delete(`/suppliers/${id}`)   (soft delete; restore = PATCH { isDeleted: false })
```

### 11.4 Pages: `src/pages/Suppliers/`

- `SuppliersPage.tsx`: `<DataGrid columns query={useSuppliers()} label="suppliers" … />` with a `<SearchInput />` in
  `<TopBarActions>`.
- Create and edit: a dialog (copy `pages/Categories/CategoryDialog.tsx`) or full pages (copy
  `pages/Products/CreateProductPage.tsx`).
- Hide every action the user can't use. The server enforces the same rules.

```tsx
const can = useCan()
{can("SUPPLIERS.CREATE") && <Button>New supplier</Button>}
{can("SUPPLIERS.EDIT") && <EditButton … />}
{can("SUPPLIERS.DELETE") && <DeleteButton … />}
```

### 11.5 Route: `src/router.tsx`

Above the `"*"` route. `RequirePermission` shows "no access" to users without it.

```tsx
{
  path: "suppliers",
  element: (
    <RequirePermission permission="SUPPLIERS.VIEW">
      <SuppliersPage />
    </RequirePermission>
  ),
},
```

### 11.6 Sidebar link: `src/app/layout/navigation.ts`

```ts
{ label: "Suppliers", to: "/suppliers", icon: TruckIcon, end: false, permission: "SUPPLIERS.VIEW" },
```

### 11.7 Sign-in and errors (nothing to write)

- Any 401 sends the user to `/login?redirect=…` (`app/layout/AppLayout.tsx`, `app/providers.tsx`).
- An unknown URL shows `NotFoundPage`. A failed detail query is shown with `<QueryError error={error} />`.
- `npm run build` and `npm run lint` must pass.

---

## 12. After deploying: grant the permissions

1. Start the server. It creates the `SUPPLIERS.*` `Permission` rows (logged at boot).
2. Open **Admin → Roles**, edit each role that needs it, and tick the SUPPLIERS permissions. Super Admin is the
   system role: it has them already and can't be edited.
3. Users get them on their next request. There's no need to sign in again.

Until step 2, everyone except Super Admin users gets 403 on the new routes, and the sidebar link stays hidden.

---

## 13. What you never touch

All of this is automatic for a new module:

| Concern | Handled by |
|---|---|
| Mounting routes under `/api/v1/<folder>` | `src/app.ts` |
| Session check, 401 / 403 | `src/platform/security/auth.plugin.ts` |
| Error response format | `src/platform/http/error-handler.plugin.ts` |
| Response caching and invalidation | `src/platform/cache/*` + the table's `notify_change` trigger |
| `Permission` table rows | `src/platform/security/permissions-sync.plugin.ts` |
| API docs at `/docs` | `src/platform/http/swagger.plugin.ts` |
| Prisma client | `src/generated/` (generated, never edit) |

---

## Checklist

**Backend (`GP-ERP-Server`)**
- [ ] `prisma/schema.prisma`: `model Supplier` with the audit columns last, plus 2 back-relation lines on `User`
- [ ] Migration created (id function at the top, cache trigger at the end) and applied (`npm run db:deploy`, `npx prisma generate`)
- [ ] `src/platform/security/permissions.ts`: its own `SUPPLIERS` group
- [ ] `src/modules/suppliers/suppliers.schema.ts`: response, list query, create body, update body (without defaults)
- [ ] `src/modules/suppliers/suppliers.service.ts`: audit columns from the actor, soft delete, business rules
- [ ] `src/modules/suppliers/suppliers.routes.ts`: a `permission` on every route, `cache` on every GET
- [ ] `test/app.test.ts`: the route in the mounts list, and every route in the access matrix
- [ ] `src/modules/suppliers/suppliers.int.test.ts`
- [ ] `README.md` / `ARCHITECTURE.md` updated
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass

**Frontend (`GP-ERP-Client`)**
- [ ] `src/app/auth.ts`: the 4 keys in `PermissionKey`
- [ ] `src/pages/Suppliers/types.ts` and `api.ts`
- [ ] `src/pages/Suppliers/SuppliersPage.tsx` (+ dialog or create / detail / edit pages), with `can(…)` on every action
- [ ] `src/router.tsx`: the route wrapped in `RequirePermission`
- [ ] `src/app/layout/navigation.ts`: the sidebar link with `SUPPLIERS.VIEW`
- [ ] `npm run build` and `npm run lint` pass

**Rollout**
- [ ] Server restarted, permissions ticked for the right roles in Admin → Roles
