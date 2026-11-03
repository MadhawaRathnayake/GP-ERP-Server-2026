# Customers screen, end to end

This is the complete build plan for the **Customers** screen: the table, the API, the permissions, the tests and the
pages in the frontend. Every code block below is the full file (or the exact edit) to use. They were checked on
copies of both repos: the backend passes `npm run typecheck`, `npm run lint`, `npm test` and
`npm run build` (apart from 5 category checks in `test/app.test.ts` that
expect `PRODUCTS.*` while the category routes now use `CATEGORY.*`); the frontend passes `npm run build` and `npm run lint`. The integration test hasn't been run (it
writes to `ERP-DB`).

For the general rules behind each step, see [ADDING-A-FEATURE.md](../../ADDING-A-FEATURE.md). To plan the next screen, copy
this file and follow [Reusing this plan for the next screen](#reusing-this-plan-for-the-next-screen).

- Backend repo: `GP-ERP-Server` (this folder). Frontend repo: `../GP-ERP-Client`.
- Customers already exist as a read-only placeholder (list and detail). This plan replaces it with the real model and
  full create, edit, delete and restore.

## Contents

1. [Status](#1-status)
2. [What you touch](#2-what-you-touch)
3. [Database](#3-database)
4. [Permissions](#4-permissions)
5. [API schema](#5-api-schema-customersschemats)
6. [Service](#6-service-customersservicets)
7. [Routes](#7-routes-customersroutests)
8. [Errors and caching](#8-errors-and-caching)
9. [Backend tests](#9-backend-tests)
10. [Backend docs](#10-backend-docs)
11. [Frontend](#11-frontend)
12. [Verify](#12-verify)
13. [Roll out](#13-roll-out)
14. [Checklist](#checklist)
15. [Reusing this plan for the next screen](#reusing-this-plan-for-the-next-screen)

---

## 1. Status

As of 2026-11-03:

| Step | File | State |
|---|---|---|
| Model | `prisma/schema.prisma` | done |
| Migration | `prisma/migrations/20261102100000_customer_details/migration.sql` | applied |
| Migration | `prisma/migrations/20261103090000_customer_optional_address/migration.sql` (address optional) | written and tested, **not applied** |
| Permissions | `src/platform/security/permissions.ts` | done (`CUSTOMERS.VIEW/CREATE/EDIT/DELETE`) |
| API schema | `src/modules/customers/customers.schema.ts` | done |
| Service | `src/modules/customers/customers.service.ts` | to do (has list, get and create; list ignores the new filters) |
| Routes | `src/modules/customers/customers.routes.ts` | to do (still uses the uuid `idParams`; POST uses the wrong permission) |
| Tests | `customers.schema.test.ts`, `customers.int.test.ts`, `test/app.test.ts` | to do |
| Docs | `README.md` | to do |
| Frontend | `../GP-ERP-Client/src/app/auth.ts`, `src/pages/Customers/*`, `src/router.tsx` | to do |

---

## 2. What you touch

| # | Area | File | New / edit |
|---|---|---|---|
| 1 | Table | `prisma/schema.prisma` | done |
| 2 | Migrations | `20261102100000_customer_details` (applied), `20261103090000_customer_optional_address` | apply the second in [step 13](#13-roll-out) |
| 3 | Permissions | `src/platform/security/permissions.ts` | done |
| 4 | Request / response shapes | `src/modules/customers/customers.schema.ts` | done |
| 5 | Business logic | `src/modules/customers/customers.service.ts` | replace |
| 6 | HTTP endpoints | `src/modules/customers/customers.routes.ts` | replace |
| 7 | Schema unit test | `src/modules/customers/customers.schema.test.ts` | new |
| 8 | Integration test | `src/modules/customers/customers.int.test.ts` | replace |
| 9 | Access matrix | `test/app.test.ts` | edit |
| 10 | Docs | `README.md` | edit the customers example |
| 11 | Frontend permission keys | `../GP-ERP-Client/src/app/auth.ts` | edit |
| 12 | Frontend data | `../GP-ERP-Client/src/pages/Customers/types.ts`, `api.ts` | replace |
| 13 | Frontend pages | `CustomersPage.tsx`, `CustomerPage.tsx` (replace), `CreateCustomerPage.tsx`, `EditCustomerPage.tsx` (new) | |
| 14 | Frontend routes | `../GP-ERP-Client/src/router.tsx` | edit |
| 15 | Sidebar link | `../GP-ERP-Client/src/app/layout/navigation.ts` | nothing: the link exists |

---

## 3. Database

### 3.1 The model

Already in `prisma/schema.prisma`:

```prisma
enum CustomerType {
  B2B
  B2C
}

model Customer {
  id             String       @id @default(dbgenerated("next_customer_id()"))
  code           String
  type           CustomerType
  title          String?
  name           String
  email          String?
  phones         String[]     @default([])
  houseNumber    String?
  street         String?
  city           String?
  district       String?
  province       String?
  country        String
  vatNumber      String?
  tinNumber      String?
  pvNumber       String?
  isCommissioned Boolean      @default(false)
  creator        User?        @relation("CustomerCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  createdBy      String?
  createdAt      DateTime     @default(now()) @db.Timestamptz(3)
  modifier       User?        @relation("CustomerModifiedBy", fields: [modifiedBy], references: [id], onDelete: SetNull)
  modifiedBy     String?
  modifiedAt     DateTime?    @db.Timestamptz(3)
  isDeleted      Boolean      @default(false)

  @@index([id])
  @@index([code])
  @@index([name])
  @@index([city])
  @@index([district])
  @@index([phones], type: Gin)
  @@index([vatNumber])
  @@index([tinNumber])
}
```

Why it looks like this:

| Field | Decision | Why |
|---|---|---|
| `id` | `CUST000001…` from `next_customer_id()` | Readable ids, like the other business tables. |
| `code` | required, **not unique** | The customer's own code. Make it `@unique` (and add the index in a new migration) if two customers may never share one. |
| `type` | enum `B2B` / `B2C` | Only two values, so the database rejects anything else. |
| `phones` | `String[]`, default `[]` | A list without a second table. Exact lookups use the GIN index. |
| `vatNumber`, `tinNumber`, `pvNumber` | optional text | B2C customers have none. Text keeps hyphens, letters and leading zeros. The format is checked by the API, not the database. |
| `city`, `district`, `province` | optional text | Walk-in customers may have no address. The frontend picks the district from a fixed list (or "No district") and sets the province from it, so filters match. |
| tax numbers | not unique | Branches of one company can share a VAT or TIN number. |

### 3.2 Indexes

| Index | Used by |
|---|---|
| primary key `id` | `GET /customers/:id`, `PATCH`, `DELETE` (automatic) |
| `code` | finding a customer by its code |
| `name` | the list's `ORDER BY name` |
| `city`, `district` | the list's `?city=` and `?district=` filters (exact match) |
| `phones` (GIN) | finding a customer by an exact phone number |
| `vatNumber`, `tinNumber` | finding a customer by an exact tax number |
| `id` | nothing: it repeats the primary key's index ([known-issues.md](../known-issues.md#duplicate-indexes)) |

None on `pvNumber`, `type`, `isDeleted` or `isCommissioned` (too few distinct values to help), or on `email` (no exact lookup
needs it yet). The `q` search uses `contains` (`ILIKE '%…%'`), which no normal index can speed up; it's fine for
thousands of customers.

### 3.3 The migrations

`prisma/migrations/20261102100000_customer_details/migration.sql` (applied) is hand-written, because the table already exists:
adding columns with `ALTER TABLE` would put them after the audit columns. It:

1. stops without changing anything if `Customer` has rows (it had 0 when written);
2. drops and recreates `Customer`, creates `next_customer_id()`, the `CustomerType` enum, the indexes, the foreign
   keys and the `Customer_notify_change` cache trigger.

`prisma/migrations/20261103090000_customer_optional_address/migration.sql` (not applied) makes `city`, `district`
and `province` optional (`DROP NOT NULL` keeps their position) and changes the indexes to match the model.

Both were tested on a throwaway database: the result matches `schema.prisma` exactly (`prisma migrate diff` found no
difference). Apply the second together with the new backend code, in [step 13](#13-roll-out).

---

## 4. Permissions

Already in `src/platform/security/permissions.ts`:

```ts
  CUSTOMERS: {
    VIEW: "View customers",
    CREATE: "Create customers",
    EDIT: "Edit customers",
    DELETE: "Delete customers"
  },
```

| Route | Permission |
|---|---|
| list, detail | `CUSTOMERS.VIEW` |
| create | `CUSTOMERS.CREATE` |
| edit, restore | `CUSTOMERS.EDIT` |
| delete | `CUSTOMERS.DELETE` |

Nobody has `CREATE`, `EDIT` or `DELETE` until an admin ticks them ([step 13](#13-roll-out)).

---

## 5. API schema: `customers.schema.ts`

Done. For reference:

```ts
import { z } from "zod"
import { pageQuery, pageResult } from "#http/pagination.js"

const customerId = z.string().regex(/^CUST\d{6,}$/, "Must be a customer id like CUST000001")

export const customerIdParams = z.object({ id: customerId })

export const customerType = z.enum(["B2B", "B2C"])

export const customer = z.object({
  id: z.string(),
  code: z.string(),
  type: customerType,
  title: z.string().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phones: z.array(z.string()),
  houseNumber: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string(),
  vatNumber: z.string().nullable(),
  tinNumber: z.string().nullable(),
  pvNumber: z.string().nullable(),
  isCommissioned: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isDeleted: z.boolean(),
})

export const customerPage = pageResult(customer)

export const listCustomersQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on code, name or email"),
  city: z.string().trim().min(1).optional().describe("Exact match on city"),
  district: z.string().trim().min(1).optional().describe("Exact match on district"),
  includeDeleted: z.stringbool().default(false).describe("Include deleted customers"),
})

const phone = z.string().trim().regex(/^\+?\d{7,15}$/, "Must be a phone number like +94771234567, with no spaces")

const customerFields = z.object({
  code: z.string().trim().min(1).max(64),
  type: customerType,
  title: z.string().trim().min(1).max(20).nullable(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
  phones: z.array(phone).max(10),
  houseNumber: z.string().trim().min(1).max(50).nullable(),
  street: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100).nullable(),
  district: z.string().trim().min(1).max(100).nullable(),
  province: z.string().trim().min(1).max(100).nullable(),
  country: z.string().trim().min(1).max(100),
  vatNumber: z.string().trim().regex(/^\d{9}-\d{4}$/, "Must be a VAT number like 109860522-7000").nullable(),
  tinNumber: z.string().trim().regex(/^\d{9}$/, "Must be a TIN number like 109860522").nullable(),
  pvNumber: z.string().trim().regex(/^PV-\d+$/, "Must be a PV number like PV-00300617").nullable(),
  isCommissioned: z.boolean(),
})

export const createCustomerBody = customerFields.extend({
  title: customerFields.shape.title.default(null),
  email: customerFields.shape.email.default(null),
  phones: customerFields.shape.phones.default([]),
  houseNumber: customerFields.shape.houseNumber.default(null),
  street: customerFields.shape.street.default(null),
  city: customerFields.shape.city.default(null),
  district: customerFields.shape.district.default(null),
  province: customerFields.shape.province.default(null),
  vatNumber: customerFields.shape.vatNumber.default(null),
  tinNumber: customerFields.shape.tinNumber.default(null),
  pvNumber: customerFields.shape.pvNumber.default(null),
  isCommissioned: customerFields.shape.isCommissioned.default(false),
})

// From the fields without defaults (see the pitfall in AGENTS.md).
export const updateCustomerBody = customerFields
  .extend({ isDeleted: z.boolean().describe("true = deleted: hidden from lists by default") })
  .partial()

export type ListCustomersQuery = z.infer<typeof listCustomersQuery>
export type CreateCustomerBody = z.infer<typeof createCustomerBody>
export type UpdateCustomerBody = z.infer<typeof updateCustomerBody>
```

Validation rules (a request that breaks one gets 400 `VALIDATION_ERROR`):

| Field | Rule | Example |
|---|---|---|
| `:id` | `CUST` + at least 6 digits | `CUST000001` |
| `code`, `name`, `country` | required | |
| `city`, `district`, `province` | optional (`null` when left out) | |
| `email` | trimmed, lower-cased, a valid address | `buyer@acme.lk` |
| `phones` | up to 10; each `+` (optional) and 7–15 digits, no spaces | `+94771234567` |
| `vatNumber` | 9 digits, hyphen, 4 digits | `109860522-7000` |
| `tinNumber` | 9 digits | `109860522` |
| `pvNumber` | `PV-` and digits | `PV-00300617` |

Create fills `phones: []`, `isCommissioned: false` and `null` for the other optional fields. Update has no defaults,
so a PATCH changes only the fields it sends. If a real VAT or TIN number doesn't fit, loosen the regex here and in
the frontend form ([11.5](#115-create-page-and-shared-form-createcustomerpagetsx)).

---

## 6. Service: `customers.service.ts`

Replace the whole file:

```ts
import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateCustomerBody, ListCustomersQuery, UpdateCustomerBody } from "./customers.schema.js"

// city and district are exact matches, so they use the Customer_city_idx and Customer_district_idx indexes.
export function listCustomers({ q, city, district, includeDeleted, ...page }: ListCustomersQuery) {
  const where: Prisma.CustomerWhereInput = {
    ...(q && {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(city && { city }),
    ...(district && { district }),
    ...(!includeDeleted && { isDeleted: false }),
  }
  return paginate(
    page,
    (args) => db.customer.findMany({ where, orderBy: { name: "asc" }, ...args }),
    () => db.customer.count({ where }),
  )
}

export async function getCustomer(id: string) {
  const customer = await db.customer.findUnique({ where: { id } })
  if (!customer) throw new NotFoundError("Customer", id)
  return customer
}

export function createCustomer(data: CreateCustomerBody, actor: Actor) {
  return db.customer.create({ data: { ...data, createdBy: actor.id } })
}

// Unknown id → Prisma P2025 → 404 (platform/http/error-handler.plugin.ts).
export function updateCustomer(id: string, data: UpdateCustomerBody, actor: Actor) {
  return db.customer.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
}

/** Customers are never deleted: they're deactivated, so their history stays. `PATCH { isDeleted: false }` restores one. */
export async function deleteCustomer(id: string, actor: Actor) {
  await updateCustomer(id, { isDeleted: true }, actor)
}
```

- The list hides deleted customers unless `includeDeleted=true`.
- `city` and `district` are exact, case-sensitive matches. The frontend sends values from its fixed district list.
  A customer without a district only shows when no district filter is set.
- `createdBy`, `modifiedBy` and `modifiedAt` come from the actor, never from the request.

---

## 7. Routes: `customers.routes.ts`

Replace the whole file:

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { createCustomerBody, customer, customerIdParams, customerPage, listCustomersQuery, updateCustomerBody } from "./customers.schema.js"
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from "./customers.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listCustomersQuery, response: { 200: customerPage } },
      config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
    },
    (req) => listCustomers(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: customerIdParams, response: { 200: customer } },
      config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
    },
    (req) => getCustomer(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createCustomerBody, response: { 201: customer } },
      config: { permission: "CUSTOMERS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createCustomer(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: customerIdParams, body: updateCustomerBody, response: { 200: customer } },
      config: { permission: "CUSTOMERS.EDIT" },
    },
    (req) => updateCustomer(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: customerIdParams },
      config: { permission: "CUSTOMERS.DELETE" },
    },
    async (req, reply) => {
      await deleteCustomer(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
```

The resulting API:

| Method | Path | Body / query | Permission | Success |
|---|---|---|---|---|
| GET | `/api/v1/customers` | `?page&limit&q&city&district&includeDeleted` | `CUSTOMERS.VIEW` | 200 `{ data, total }` |
| GET | `/api/v1/customers/:id` | | `CUSTOMERS.VIEW` | 200 customer |
| POST | `/api/v1/customers` | `createCustomerBody` | `CUSTOMERS.CREATE` | 201 customer |
| PATCH | `/api/v1/customers/:id` | `updateCustomerBody` (`{ isDeleted: false }` restores) | `CUSTOMERS.EDIT` | 200 customer |
| DELETE | `/api/v1/customers/:id` | | `CUSTOMERS.DELETE` | 204 |

`limit` is at most 100. The frontend's `fetchAll` reads every page.

---

## 8. Errors and caching

| Situation | Response | Comes from |
|---|---|---|
| Bad body, query or id format | 400 `VALIDATION_ERROR` | zod |
| Not signed in | 401 `UNAUTHENTICATED` | `auth.plugin.ts` |
| Missing permission | 403 `FORBIDDEN` | `auth.plugin.ts` |
| Unknown id | 404 `NOT_FOUND` | `getCustomer` / Prisma P2025 |

No 409: nothing on `Customer` is unique except the id. Both GET routes have `cache: ["Customer"]`; any write to the
table clears them through the trigger.

---

## 9. Backend tests

### 9.1 Schema unit test (new): `src/modules/customers/customers.schema.test.ts`

Runs with `npm test`, no database:

```ts
import { describe, expect, it } from "vitest"
import { createCustomerBody, customerIdParams, updateCustomerBody } from "./customers.schema.js"

const required = { code: "C-1", type: "B2B", name: "Acme", city: "Colombo", district: "Colombo", province: "Western", country: "Sri Lanka" }

describe("customer bodies", () => {
  it("fills defaults on create", () => {
    expect(createCustomerBody.parse(required)).toMatchObject({ phones: [], isCommissioned: false, email: null, vatNumber: null })
  })

  it("doesn't need an address", () => {
    const body = createCustomerBody.parse({ code: "C-2", type: "B2C", name: "Walk-in", country: "Sri Lanka" })
    expect(body).toMatchObject({ city: null, district: null, province: null })
  })

  it("accepts the tax number formats and lower-cases the email", () => {
    const body = createCustomerBody.parse({
      ...required,
      email: "Buyer@Acme.LK",
      vatNumber: "109860522-7000",
      tinNumber: "109860522",
      pvNumber: "PV-00300617",
    })
    expect(body.email).toBe("buyer@acme.lk")
  })

  it("rejects badly formatted numbers", () => {
    expect(createCustomerBody.safeParse({ ...required, vatNumber: "109860522" }).success).toBe(false)
    expect(createCustomerBody.safeParse({ ...required, tinNumber: "1098" }).success).toBe(false)
    expect(createCustomerBody.safeParse({ ...required, phones: ["077 123 4567"] }).success).toBe(false)
  })

  it("leaves fields that a PATCH doesn't send untouched", () => {
    expect(updateCustomerBody.parse({ name: "Renamed" })).toEqual({ name: "Renamed" })
  })

  it("only accepts CUST ids", () => {
    expect(customerIdParams.safeParse({ id: "CUST000001" }).success).toBe(true)
    expect(customerIdParams.safeParse({ id: "00000000-0000-4000-8000-000000000002" }).success).toBe(false)
  })
})
```

### 9.2 Access matrix: `test/app.test.ts`

Three edits.

1. Replace `const anId = "00000000-0000-4000-8000-000000000002"` (only customers used it) with an id next to the
   others:

   ```ts
   const aCategoryId = "CAT0002"
   const aCustomerId = "CUST000002"
   ```

2. Replace the customer detail row with all four:

   ```ts
       ["GET", "/api/v1/customers", "CUSTOMERS.VIEW"],
       ["GET", `/api/v1/customers/${aCustomerId}`, "CUSTOMERS.VIEW"],
       ["POST", "/api/v1/customers", "CUSTOMERS.CREATE"],
       ["PATCH", `/api/v1/customers/${aCustomerId}`, "CUSTOMERS.EDIT"],
       ["DELETE", `/api/v1/customers/${aCustomerId}`, "CUSTOMERS.DELETE"],
   ```

3. The docs test checks that money is documented as a number using `creditLimit`, which customers no longer have.
   Check `price` on products instead:

   ```ts
       const price = spec.paths["/api/v1/products/{id}"].get.responses["200"].content["application/json"].schema.properties.price
       expect(price.type).toBe("number")
   ```

### 9.3 Integration test (replace): `src/modules/customers/customers.int.test.ts`

Uses the real `ERP-DB` and Redis, so ask before running `npm run test:int`. It removes its rows (codes start with
`TEST-`) and its users afterwards:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { App } from "#app.js"
import { db } from "#core/db.js"
import { cleanupTestUsers, signIn, startApp, waitForChange, type TestUser } from "#test/helpers.js"

let app: App
let user: TestUser // can view, create, edit and delete customers
let viewer: TestUser // can only view them
const code = `TEST-${Date.now()}`
// A district no real customer has, so the filters only find this test's customer.
const district = `TEST-District-${Date.now()}`
const body = { code, type: "B2B", name: "Test Customer Ltd", city: "Colombo", district, province: "Western", country: "Sri Lanka" }

beforeAll(async () => {
  app = await startApp()
  user = await signIn(app, ["CUSTOMERS.VIEW", "CUSTOMERS.CREATE", "CUSTOMERS.EDIT", "CUSTOMERS.DELETE"])
  viewer = await signIn(app, ["CUSTOMERS.VIEW"])
})

afterAll(async () => {
  await db.customer.deleteMany({ where: { code: { startsWith: "TEST-" } } }) // test rows start with TEST-
  await cleanupTestUsers()
  await app.close()
})

describe("customers", () => {
  let id: string

  it("creates a customer with a CUST id", async () => {
    const payload = { ...body, phones: ["+94771234567"] }
    const res = await app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie: user.cookie }, payload })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ code, phones: ["+94771234567"], isCommissioned: false, createdBy: user.id, isDeleted: false })
    expect(res.json().id).toMatch(/^CUST\d{6,}$/)
    id = res.json().id
  })

  it("needs CUSTOMERS.CREATE to create", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie: viewer.cookie }, payload: body })
    expect(res.statusCode).toBe(403)
  })

  it("filters by district and city", async () => {
    const res = await app.inject({ url: `/api/v1/customers?district=${district}&city=Colombo`, headers: { cookie: viewer.cookie } })
    expect(res.json()).toMatchObject({ total: 1, data: [{ id }] })
    const other = await app.inject({ url: `/api/v1/customers?district=${district}&city=Kandy`, headers: { cookie: viewer.cookie } })
    expect(other.json().total).toBe(0)
  })

  it("edits a customer; the cached detail is cleared", async () => {
    const url = `/api/v1/customers/${id}`
    await app.inject({ url, headers: { cookie: viewer.cookie } })
    expect((await app.inject({ url, headers: { cookie: viewer.cookie } })).headers["x-cache"]).toBe("HIT")

    const changed = waitForChange("Customer")
    const res = await app.inject({ method: "PATCH", url, headers: { cookie: user.cookie }, payload: { name: "Renamed Ltd" } })
    expect(res.json()).toMatchObject({ name: "Renamed Ltd", city: "Colombo", modifiedBy: user.id })
    await changed
    expect((await app.inject({ url, headers: { cookie: viewer.cookie } })).json().name).toBe("Renamed Ltd")
  })

  it("deletes softly: hidden from the list unless includeDeleted=true", async () => {
    const changed = waitForChange("Customer")
    expect((await app.inject({ method: "DELETE", url: `/api/v1/customers/${id}`, headers: { cookie: user.cookie } })).statusCode).toBe(204)
    await changed
    const list = await app.inject({ url: `/api/v1/customers?district=${district}`, headers: { cookie: viewer.cookie } })
    expect(list.json().total).toBe(0)
    const all = await app.inject({ url: `/api/v1/customers?district=${district}&includeDeleted=true`, headers: { cookie: viewer.cookie } })
    expect(all.json().data).toContainEqual(expect.objectContaining({ id, isDeleted: true }))
  })

  it("404s for an unknown id and 400s for a malformed one", async () => {
    expect((await app.inject({ url: "/api/v1/customers/CUST999999999", headers: { cookie: user.cookie } })).statusCode).toBe(404)
    expect((await app.inject({ url: "/api/v1/customers/123", headers: { cookie: user.cookie } })).statusCode).toBe(400)
  })
})
```

---

## 10. Backend docs

- `README.md` → "Adding an API (example: customers)" shows the old model (`id` uuid, `creditLimit`) and an old
  `listCustomers`. Update the snippets to match sections 3, 5 and 6, or point it at this file.
- `ARCHITECTURE.md`: nothing; `customers` is already in the module list.

---

## 11. Frontend

Repo `../GP-ERP-Client`. Read its `AGENTS.md` first. The screens copy the Products pattern: a list, a detail page,
and full create and edit pages, because the form has too many fields for a dialog.

How the list is filtered:

- **District**: a dropdown in the top bar, kept in the URL (`?district=Colombo`), sent to the server as an exact
  filter (indexed).
- **City, name, phone, email**: the search box. `DataGrid` searches every column in the browser, and City is a
  column, so typing "Dehiwala" finds those customers.
- The API also takes `?city=` for exact matches; the screen doesn't need it.

### 11.1 Permission keys: `src/app/auth.ts`

Add the three new keys after `"CUSTOMERS.VIEW"`:

```ts
  | "CUSTOMERS.VIEW"
  | "CUSTOMERS.CREATE"
  | "CUSTOMERS.EDIT"
  | "CUSTOMERS.DELETE"
```

### 11.2 Types: `src/pages/Customers/types.ts`

Replace the whole file. It also holds the district list, so the form and the filter use the same names:

```ts
// B2B = a business, B2C = a person.
export type CustomerType = "B2B" | "B2C"

export interface Customer {
  // "CUST000001"
  id: string
  code: string
  type: CustomerType
  title: string | null
  name: string
  email: string | null
  // e.g. ["+94771234567"]
  phones: string[]
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
  isCommissioned: boolean
  createdBy: string | null
  createdAt: string
  modifiedBy: string | null
  modifiedAt: string | null
  // true = deleted; it can be restored.
  isDeleted: boolean
}

// On create, phones defaults to [], isCommissioned to false, and the other optional fields to null.
export type NewCustomer = Pick<Customer, "code" | "type" | "name" | "country"> &
  Partial<
    Pick<
      Customer,
      | "title"
      | "email"
      | "phones"
      | "houseNumber"
      | "street"
      | "city"
      | "district"
      | "province"
      | "vatNumber"
      | "tinNumber"
      | "pvNumber"
      | "isCommissioned"
    >
  >

export type CustomerUpdate = Partial<NewCustomer & { isDeleted: boolean }> & { id: string }

// Exact-match filters the server applies to the list.
export interface CustomerFilters {
  district?: string
  city?: string
}

// Sri Lanka's 25 districts and their province. The form saves the province of the chosen district, so the two always
// match. A customer without a district is listed only under "All districts".
export const DISTRICT_PROVINCES = {
  Ampara: "Eastern",
  Anuradhapura: "North Central",
  Badulla: "Uva",
  Batticaloa: "Eastern",
  Colombo: "Western",
  Galle: "Southern",
  Gampaha: "Western",
  Hambantota: "Southern",
  Jaffna: "Northern",
  Kalutara: "Western",
  Kandy: "Central",
  Kegalle: "Sabaragamuwa",
  Kilinochchi: "Northern",
  Kurunegala: "North Western",
  Mannar: "Northern",
  Matale: "Central",
  Matara: "Southern",
  Monaragala: "Uva",
  Mullaitivu: "Northern",
  "Nuwara Eliya": "Central",
  Polonnaruwa: "North Central",
  Puttalam: "North Western",
  Ratnapura: "Sabaragamuwa",
  Trincomalee: "Eastern",
  Vavuniya: "Northern",
} as const

export type District = keyof typeof DISTRICT_PROVINCES

export const DISTRICTS = Object.keys(DISTRICT_PROVINCES) as District[]
```

### 11.3 API calls and hooks: `src/pages/Customers/api.ts`

Replace the whole file:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { fetchAll, http } from "@/lib/http"

import type { Customer, CustomerFilters, CustomerUpdate, NewCustomer } from "./types"

// Every active customer matching the filters, so the grid can search, sort and page across them in the browser.
// The filters run on the server (exact match, indexed); the search box runs in the browser.
export function fetchCustomers(filters: CustomerFilters): Promise<Customer[]> {
  const params = new URLSearchParams()
  if (filters.district) params.set("district", filters.district)
  if (filters.city) params.set("city", filters.city)
  const query = params.toString()
  return fetchAll<Customer>(query ? `/customers?${query}` : "/customers")
}

export async function fetchCustomer(id: string): Promise<Customer> {
  const { data } = await http.get<Customer>(`/customers/${id}`)
  return data
}

export async function createCustomer(newCustomer: NewCustomer): Promise<Customer> {
  const { data } = await http.post<Customer>("/customers", newCustomer)
  return data
}

export async function updateCustomer({ id, ...changes }: CustomerUpdate): Promise<Customer> {
  const { data } = await http.patch<Customer>(`/customers/${id}`, changes)
  return data
}

// Soft delete: the server sets isDeleted = true. `updateCustomer({ id, isDeleted: false })` restores it.
export async function deleteCustomer(id: string): Promise<void> {
  await http.delete(`/customers/${id}`)
}

export function useCustomers(filters: CustomerFilters = {}) {
  // The full list is several requests, so keep it for a few minutes instead of refetching on every visit.
  return useQuery({ queryKey: ["customers", "list", filters], queryFn: () => fetchCustomers(filters), staleTime: 5 * 60_000 })
}

export function useCustomer(id: string) {
  return useQuery({ queryKey: ["customers", "detail", id], queryFn: () => fetchCustomer(id) })
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast.success(`Created customer "${customer.name}"`)
    },
    onError: (error) => {
      toast.error(`Could not create customer: ${error.message}`)
    },
  })
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateCustomer,
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast.success(`Saved customer "${customer.name}"`)
    },
    onError: (error) => {
      toast.error(`Could not save customer: ${error.message}`)
    },
  })
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast.success("Deleted the customer")
    },
    onError: (error) => {
      toast.error(`Could not delete customer: ${error.message}`)
    },
  })
}
```

### 11.4 List page: `src/pages/Customers/CustomersPage.tsx`

Replace the whole file:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { PlusIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"

import { useCan } from "@/app/auth"
import { DataGrid, type GridFeatures } from "@/components/DataGrid"
import { SearchInput } from "@/components/SearchInput"
import { TopBarActions } from "@/components/TopBarActions"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { useCustomers } from "./api"
import { DISTRICTS, type Customer } from "./types"

const columnHelper = createColumnHelper<GridFeatures, Customer>()

// A Select item can't have an empty value, so "all" stands for "no district filter".
const ALL_DISTRICTS = "all"

const columns = columnHelper.columns([
  columnHelper.accessor("code", {
    header: "Code",
    cell: (info) => (
      <Link to={`/customers/${info.row.original.id}`} className="font-medium hover:underline">
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("type", { header: "Type" }),
  columnHelper.accessor((customer) => customer.city ?? "", {
    id: "city",
    header: "City",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor((customer) => customer.district ?? "", {
    id: "district",
    header: "District",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor((customer) => customer.phones.join(", "), {
    id: "phones",
    header: "Phone",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor((customer) => customer.email ?? "", {
    id: "email",
    header: "Email",
    cell: (info) => info.getValue() || "—",
  }),
])

export function CustomersPage() {
  const can = useCan()
  const [searchParams, setSearchParams] = useSearchParams()
  const district = searchParams.get("district") ?? ""
  const customers = useCustomers({ district })

  const onDistrictChange = (value: string) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (value === ALL_DISTRICTS) next.delete("district")
        else next.set("district", value)
        // Different rows, so the grid goes back to its first page.
        next.delete("page")
        return next
      },
      { replace: true },
    )
  }

  return (
    <div className="space-y-4">
      <TopBarActions>
        <SearchInput placeholder="Search name, city, phone…" />
        <Select value={district || ALL_DISTRICTS} onValueChange={onDistrictChange}>
          <SelectTrigger className="w-48" aria-label="District">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_DISTRICTS}>All districts</SelectItem>
            {DISTRICTS.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {can("CUSTOMERS.CREATE") && (
          <Button asChild>
            <Link to="/customers/create">
              <PlusIcon />
              New customer
            </Link>
          </Button>
        )}
      </TopBarActions>
      <h1 className="text-2xl font-semibold">Customers</h1>
      <DataGrid
        columns={columns}
        query={customers}
        label="customers"
        getRowId={(customer) => customer.id}
        rowHref={(customer) => `/customers/${customer.id}`}
      />
    </div>
  )
}
```

### 11.5 Create page and shared form: `CreateCustomerPage.tsx`

New file. `CustomerForm` is shared with the edit page. Phone numbers use `useFieldArray` (add and remove rows).
Province isn't typed: it's saved from the chosen district. City and district are optional; "No district" saves
`null` for both district and province.

```tsx
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeftIcon, PlusIcon, XIcon } from "lucide-react"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { Link, useNavigate } from "react-router-dom"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { useCreateCustomer } from "./api"
import { DISTRICT_PROVINCES, DISTRICTS, type Customer, type District, type NewCustomer } from "./types"

// The same formats the server checks (GP-ERP-Server customers.schema.ts). Blank optional fields are saved as null.
// A Select item can't have an empty value, so "none" stands for "no district" (saved as null).
const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`)
const required = (label: string, max: number) => optional(max).min(1, `${label} is required`)

const NO_DISTRICT = "none"

const schema = z.object({
  code: required("Code", 64),
  type: z.enum(["B2B", "B2C"]),
  title: optional(20),
  name: required("Name", 200),
  email: z.union([z.literal(""), z.email("Enter an email address, e.g. buyer@example.lk")]),
  // Objects, because react-hook-form's useFieldArray can't hold plain strings.
  phones: z
    .array(z.object({ value: z.string().trim().regex(/^\+?\d{7,15}$/, "Digits only, e.g. +94771234567") }))
    .max(10, "Add at most 10 numbers"),
  houseNumber: optional(50),
  street: optional(200),
  city: optional(100),
  district: z.string().refine((value) => value === NO_DISTRICT || value in DISTRICT_PROVINCES, "Choose a district"),
  country: required("Country", 100),
  vatNumber: z.string().trim().regex(/^(\d{9}-\d{4})?$/, "Format: 109860522-7000"),
  tinNumber: z.string().trim().regex(/^(\d{9})?$/, "Format: 9 digits, e.g. 109860522"),
  pvNumber: z.string().trim().regex(/^(PV-\d+)?$/, "Format: PV-00300617"),
  isCommissioned: z.boolean(),
})

type CustomerValues = z.infer<typeof schema>

// Plain text boxes, in the order they appear on the form.
const textFields = [
  { name: "code", label: "Code", placeholder: "C-1001" },
  { name: "name", label: "Name", placeholder: "Customer or company name" },
  { name: "title", label: "Title", placeholder: "Optional, e.g. Mr" },
  { name: "email", label: "Email", placeholder: "Optional" },
  { name: "houseNumber", label: "House number", placeholder: "Optional" },
  { name: "street", label: "Street", placeholder: "Optional" },
  { name: "city", label: "City", placeholder: "Optional, e.g. Dehiwala" },
  { name: "country", label: "Country", placeholder: "Sri Lanka" },
  { name: "vatNumber", label: "VAT number", placeholder: "Optional, e.g. 109860522-7000" },
  { name: "tinNumber", label: "TIN number", placeholder: "Optional, e.g. 109860522" },
  { name: "pvNumber", label: "PV number", placeholder: "Optional, e.g. PV-00300617" },
] as const

interface CustomerFormProps {
  title: string
  submitLabel: string
  pending: boolean
  // Edit passes the saved customer; create starts empty.
  customer?: Customer
  onSubmit: (customer: NewCustomer) => void
}

export function CreateCustomerPage() {
  const navigate = useNavigate()
  const createCustomer = useCreateCustomer()

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/customers">
          <ArrowLeftIcon />
          Back to customers
        </Link>
      </Button>
      <CustomerForm
        title="Create customer"
        submitLabel="Create"
        pending={createCustomer.isPending}
        onSubmit={(customer) =>
          createCustomer.mutate(customer, { onSuccess: (created) => navigate(`/customers/${created.id}`) })
        }
      />
    </div>
  )
}

// Shared by the create and edit pages.
export function CustomerForm({ title, submitLabel, pending, customer, onSubmit }: CustomerFormProps) {
  const form = useForm<CustomerValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: customer?.code ?? "",
      type: customer?.type ?? "B2B",
      title: customer?.title ?? "",
      name: customer?.name ?? "",
      email: customer?.email ?? "",
      phones: customer?.phones.map((value) => ({ value })) ?? [],
      houseNumber: customer?.houseNumber ?? "",
      street: customer?.street ?? "",
      city: customer?.city ?? "",
      district: customer?.district ?? NO_DISTRICT,
      country: customer?.country ?? "Sri Lanka",
      vatNumber: customer?.vatNumber ?? "",
      tinNumber: customer?.tinNumber ?? "",
      pvNumber: customer?.pvNumber ?? "",
      isCommissioned: customer?.isCommissioned ?? false,
    },
  })
  const phones = useFieldArray({ control: form.control, name: "phones" })
  const district = useWatch({ control: form.control, name: "district" })

  const submit = (values: CustomerValues) => {
    onSubmit({
      ...values,
      title: values.title || null,
      email: values.email || null,
      phones: values.phones.map((phone) => phone.value),
      houseNumber: values.houseNumber || null,
      street: values.street || null,
      city: values.city || null,
      district: values.district === NO_DISTRICT ? null : values.district,
      province: values.district === NO_DISTRICT ? null : DISTRICT_PROVINCES[values.district as District],
      vatNumber: values.vatNumber || null,
      tinNumber: values.tinNumber || null,
      pvNumber: values.pvNumber || null,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="B2B">Business (B2B)</SelectItem>
                      <SelectItem value="B2C">Person (B2C)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {textFields.map(({ name, label, placeholder }) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input placeholder={placeholder} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name="district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>District</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_DISTRICT}>No district</SelectItem>
                      {DISTRICTS.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium">Province</p>
              <p className="text-sm text-muted-foreground">
                {DISTRICT_PROVINCES[district as District] ?? "—"}
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Phone numbers</p>
              {phones.fields.map((phone, index) => (
                <FormField
                  key={phone.id}
                  control={form.control}
                  name={`phones.${index}.value`}
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input inputMode="tel" placeholder="+94771234567" {...field} />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Remove phone number"
                          onClick={() => phones.remove(index)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => phones.append({ value: "" })}>
                <PlusIcon />
                Add phone number
              </Button>
            </div>
            <FormField
              control={form.control}
              name="isCommissioned"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 sm:col-span-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                  </FormControl>
                  <FormLabel>Commissioned</FormLabel>
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending || (customer !== undefined && !form.formState.isDirty)}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  )
}
```

### 11.6 Edit page: `src/pages/Customers/EditCustomerPage.tsx`

New file:

```tsx
import { ArrowLeftIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { QueryError } from "@/components/StatusView"
import { Button } from "@/components/ui/button"

import { useCustomer, useUpdateCustomer } from "./api"
import { CustomerForm } from "./CreateCustomerPage"

export function EditCustomerPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const customer = useCustomer(id)
  const updateCustomer = useUpdateCustomer()

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/customers/${id}`}>
          <ArrowLeftIcon />
          Back to customer
        </Link>
      </Button>
      {customer.isPending ? (
        <p className="text-sm text-muted-foreground">Loading customer…</p>
      ) : customer.isError ? (
        <QueryError error={customer.error} />
      ) : (
        <CustomerForm
          title={`Edit ${customer.data.name}`}
          submitLabel="Save changes"
          pending={updateCustomer.isPending}
          customer={customer.data}
          onSubmit={(changes) =>
            updateCustomer.mutate({ id, ...changes }, { onSuccess: () => navigate(`/customers/${id}`) })
          }
        />
      )}
    </div>
  )
}
```

### 11.7 Detail page: `src/pages/Customers/CustomerPage.tsx`

Replace the whole file. Delete asks first; a deleted customer shows Restore instead:

```tsx
import { ArrowLeftIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { useCan } from "@/app/auth"
import { useFormat } from "@/app/settings"
import { QueryError } from "@/components/StatusView"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { useCustomer, useDeleteCustomer, useUpdateCustomer } from "./api"

const typeLabels = { B2B: "Business (B2B)", B2C: "Person (B2C)" }

export function CustomerPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const format = useFormat()
  const { data: customer, isPending, isError, error } = useCustomer(id)
  const deleteCustomer = useDeleteCustomer()
  const updateCustomer = useUpdateCustomer()

  if (isPending || isError) {
    return (
      <div className="space-y-4">
        <BackLink />
        {isPending ? <p className="text-sm text-muted-foreground">Loading customer…</p> : <QueryError error={error} />}
      </div>
    )
  }

  const address = [customer.houseNumber, customer.street, customer.city].filter(Boolean).join(", ")
  const details: [string, ReactNode][] = [
    ["Code", customer.code],
    ["Type", typeLabels[customer.type]],
    ["Name", [customer.title, customer.name].filter(Boolean).join(" ")],
    ["Email", customer.email ?? "—"],
    ["Phone", customer.phones.length > 0 ? customer.phones.join(", ") : "—"],
    ["Address", address || "—"],
    ["District", customer.district ?? "—"],
    ["Province", customer.province ?? "—"],
    ["Country", customer.country],
    ["VAT number", customer.vatNumber ?? "—"],
    ["TIN number", customer.tinNumber ?? "—"],
    ["PV number", customer.pvNumber ?? "—"],
    ["Commissioned", customer.isCommissioned ? "Yes" : "No"],
    ["Status", customer.isDeleted ? <span className="text-destructive">Deleted</span> : "Active"],
    ["Customer ID", customer.id],
    ["Created", format.dateTime(customer.createdAt)],
    ["Modified", customer.modifiedAt ? format.dateTime(customer.modifiedAt) : "—"],
  ]

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{customer.name}</h1>
      <BackLink />
      <div className="max-w-3xl space-y-4">
        <dl className="border-t">
          {details.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[minmax(8rem,14rem)_1fr] gap-4 border-b px-2 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {(can("CUSTOMERS.EDIT") || can("CUSTOMERS.DELETE")) && (
          <div className="flex flex-wrap gap-2">
            {!customer.isDeleted
              ? can("CUSTOMERS.DELETE") && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="destructive">
                        <Trash2Icon />
                        Delete
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete {customer.name}?</DialogTitle>
                        <DialogDescription>
                          It is hidden from the customers list and keeps its history. You can restore it from this page.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button
                          variant="destructive"
                          disabled={deleteCustomer.isPending}
                          onClick={() =>
                            deleteCustomer.mutate(customer.id, { onSuccess: () => navigate("/customers", { replace: true }) })
                          }
                        >
                          {deleteCustomer.isPending ? "Deleting…" : "Delete customer"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )
              : can("CUSTOMERS.EDIT") && (
                  <Button
                    variant="outline"
                    disabled={updateCustomer.isPending}
                    onClick={() => updateCustomer.mutate({ id: customer.id, isDeleted: false })}
                  >
                    <RotateCcwIcon />
                    Restore
                  </Button>
                )}
            {can("CUSTOMERS.EDIT") && (
              <Button asChild>
                <Link to={`/customers/${customer.id}/edit`}>
                  <PencilIcon />
                  Edit
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/customers">
        <ArrowLeftIcon />
        Back to customers
      </Link>
    </Button>
  )
}
```

### 11.8 Routes: `src/router.tsx`

Add the two imports:

```tsx
import { CreateCustomerPage } from "@/pages/Customers/CreateCustomerPage"
import { EditCustomerPage } from "@/pages/Customers/EditCustomerPage"
```

Add `customers/create` and `customers/:id/edit` next to `customers/:id`. React Router prefers the fixed `create` over
`:id` whatever the order; the create link and the route must use the same word, or `create` is read as an id:

```tsx
      {
        path: "customers/create",
        element: (
          <RequirePermission permission="CUSTOMERS.CREATE">
            <CreateCustomerPage />
          </RequirePermission>
        ),
      },
      {
        path: "customers/:id",
        // … unchanged …
      },
      {
        path: "customers/:id/edit",
        element: (
          <RequirePermission permission="CUSTOMERS.EDIT">
            <EditCustomerPage />
          </RequirePermission>
        ),
      },
```

### 11.9 Sidebar

Nothing to do: `src/app/layout/navigation.ts` already has Customers with `CUSTOMERS.VIEW`.

---

## 12. Verify

Backend (`GP-ERP-Server`), all four must pass:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Ask before `npm run test:int`.

Frontend (`GP-ERP-Client`):

```bash
npm run build
npm run lint
```

Then, with the migration applied and the server running, in the browser:

1. Create a B2B customer with two phone numbers and a VAT number. It opens on its `CUST…` detail page.
2. Try `109860522` as the VAT number: the form refuses it.
3. Create a B2C customer with no city and "No district": it saves, and shows "—" for the address.
4. Pick its district in the list's dropdown: it shows; pick another district: it's gone.
5. Type its city in the search box: it shows.
6. Edit only the name: everything else stays.
7. Delete it: it leaves the list. Open its URL again and press Restore.
8. Sign in as a user with only `CUSTOMERS.VIEW`: no New, Edit or Delete buttons, and `/customers/create` says "no access".

---

## 13. Roll out

In this order, so the API never runs against the wrong table:

1. Backend code from sections 5–9 is in place and the checks in section 12 pass.
2. Stop the server. Apply the migrations (`db:deploy` applies every one not applied yet) and regenerate the client:

   ```bash
   npm run db:deploy
   npx prisma generate
   ```

3. Start Redis and the server (`npm run dev`).
4. **Admin → Roles**: tick `CUSTOMERS.CREATE`, `EDIT` and `DELETE` for the roles that need them (Super Admin
   included). Until then everyone gets 403 and the buttons stay hidden.
5. Deploy the frontend.

---

## Checklist

**Backend (`GP-ERP-Server`)**
- [x] `prisma/schema.prisma`: `Customer` with the audit columns last and its indexes
- [x] Migrations written and tested on a throwaway database
- [x] `permissions.ts`: `CUSTOMERS.VIEW/CREATE/EDIT/DELETE`
- [x] `customers.schema.ts`
- [ ] `customers.service.ts` (section 6)
- [ ] `customers.routes.ts` (section 7)
- [ ] `customers.schema.test.ts`, `customers.int.test.ts`, `test/app.test.ts` (section 9)
- [ ] `README.md` customers example (section 10)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass

**Frontend (`GP-ERP-Client`)**
- [ ] `src/app/auth.ts`: the three new keys
- [ ] `src/pages/Customers/types.ts`, `api.ts`
- [ ] `CustomersPage.tsx`, `CustomerPage.tsx`, `CreateCustomerPage.tsx`, `EditCustomerPage.tsx`
- [ ] `src/router.tsx`: `customers/create` and `customers/:id/edit`
- [ ] `npm run build`, `npm run lint` pass

**Rollout**
- [ ] Migration applied (`npm run db:deploy`, `npx prisma generate`), server restarted
- [ ] Permissions ticked in Admin → Roles
- [ ] Browser checks in section 12

---

## Reusing this plan for the next screen

Copy this file as `docs/screens/<screen>.md` and fill in each section before writing code. Decide these first; they are
the parts `ADDING-A-FEATURE.md` leaves to you:

1. **Fields.** For each one: required or optional, a default, and its type. Text for anything with letters, hyphens
   or leading zeros (tax numbers, phone numbers, codes). An enum when there are a few fixed values. `String[]` for a
   simple list; a separate table when list items have their own fields or are searched by part.
2. **Uniqueness.** Mark a column `@unique` only if two rows may never share it, including deleted rows (soft-deleted
   rows keep their values).
3. **Indexes.** One per exact filter or lookup the screen or other code will use, and one for the list's sort
   column. Foreign key columns (e.g. `categoryId`) always get one. Skip columns with only a few distinct values.
4. **Filters.** Server filters for exact, indexed fields (dropdowns); the search box for everything else, because
   `DataGrid` searches the loaded rows in the browser.
5. **Validation.** The same rules in the API schema and the frontend form.
6. **Migration.** A new table: `npm run db:migrate`, plus a hand-written id function for a prefixed id
   (ADDING-A-FEATURE.md 2.2). Changing an existing table: write the SQL by hand, test it on a throwaway database,
   and apply it with `npm run db:deploy`. `prisma migrate dev` (which `db:migrate` runs) offers to **reset the
   database** if it finds drift: on the shared `ERP-DB`, always answer no.
7. **Rollout order.** Code and migration together, then permissions in the role editor.
