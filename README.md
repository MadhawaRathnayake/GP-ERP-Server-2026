# GP ERP Server

Fastify 5 · Prisma 7 · PostgreSQL · Redis · TypeScript (strict) · zod

## Quick start

```bash
npm install
cp .env.example .env          # set DATABASE_URL, REDIS_URL, SEED_ADMIN_EMAIL/PASSWORD
npm run db:migrate            # create tables + cache triggers
npm run db:seed               # Super Admin role (all permissions) + first admin user
npm run dev                   # http://localhost:3000  ·  docs at /docs
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Watch mode with the debugger on port 9229 |
| `npm run build` / `npm start` | Compile to `dist/` / run compiled build |
| `npm test` | Unit tests (no DB/Redis needed) |
| `npm run test:int` | Integration tests against the DB/Redis in `.env` |
| `npm run lint` / `npm run typecheck` | ESLint / tsc |
| `npm run db:migrate [-- --name x]` | Create + apply a migration from `schema.prisma`, add cache triggers, regenerate client |
| `npm run db:deploy` | Apply migrations in production (no prompts) |
| `npm run db:studio` | Browse data |

## Folder map

The layers, the dependency rules and how to add mobile, background jobs or social media are in
**[ARCHITECTURE.md](ARCHITECTURE.md)**. In short:

```
src/
├─ server.ts                entry point (starts the HTTP server)
├─ app.ts                   app setup: platform plugins in order, then every module under /api/v1
├─ config/env.ts            .env validated with zod (server refuses to start on bad config)
├─ platform/                HOW the app works — configure it per route, rarely edit it
│  ├─ core/                 db.ts (Prisma) · redis.ts · logger.ts · connections.plugin.ts
│  ├─ cache/                cache.ts (remember) · route-cache.plugin.ts (config.cache) · db-events.plugin.ts (NOTIFY → invalidate)
│  ├─ http/                 api-version.ts · errors.ts · pagination.ts · fields.ts (money, idParams)
│  │                        error-handler.plugin.ts · swagger.plugin.ts (/docs)
│  └─ security/             permissions.ts (every permission code — the source of truth) · permission-table.ts
│                           current-user.ts · sessions.ts · password.ts
│                           auth.plugin.ts (401/403, req.user) · permissions-sync.plugin.ts
├─ modules/<name>/          WHAT the app does — ONE FOLDER PER FEATURE → mounted at /api/v1/<name>
│  ├─ <name>.schema.ts      zod: request/response shapes (validation + types + docs)
│  ├─ <name>.service.ts     plain functions: business + database logic. Nothing HTTP-related.
│  ├─ <name>.routes.ts      endpoints: schema + config (auth, cache) + call the service
│  └─ <name>.int.test.ts    tests against the real DB
└─ generated/               Prisma client (generated, never edited)
prisma/   schema.prisma · migrations/ · seed.ts
scripts/  migrate.ts
test/     helpers.ts (startApp, signIn, waitForChange) · app.test.ts (wiring + access matrix)
```

`*.plugin.ts` files hook into every request or into startup; everything else is plain functions.

**Imports:** use an alias for anything outside the file's own folder, and `./` inside it. ESLint rejects `../`.

```ts
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import { product } from "./products.schema.js"
```

| Alias | Folder |
| --- | --- |
| `#core/*` `#cache/*` `#http/*` `#security/*` | `src/platform/<same name>/` |
| `#config/*` `#modules/*` `#generated/*` | `src/<same name>/` |
| `#app.js` | `src/app.ts` |
| `#test/*` | `test/` (tests only) |

They're Node's own [subpath imports](https://nodejs.org/api/v1/packages.html#subpath-imports) (`package.json` →
`imports`): no build step, no runtime cost. Run TypeScript entry points with `tsx --conditions=development`; the npm
scripts and `.vscode/launch.json` already do.

## What happens on a request

```
GET /api/v1/customers?q=acme
 1. auth          (security/auth.plugin.ts)     session → Redis, else DB → req.user; 401 / 403
 2. route cache   (cache/route-cache.plugin.ts) Redis hit → respond, x-cache: HIT
 3. validation    zod querystring          400 VALIDATION_ERROR with details
 4. handler       customers.routes.ts → listCustomers() in customers.service.ts → Prisma
 5. serialization zod response schema      Decimal → number, Date → ISO string
 6. route cache   store the response (x-cache: MISS)
 errors at any step → http/error-handler.plugin.ts
```

Every log line for the request carries the same `reqId`, which is also returned as the `x-request-id` header.

## Adding an API (example: customers)

`src/modules/customers/` is the reference. A new feature touches only these places. For the full walkthrough, backend and frontend with code for every file, see [ADDING-A-FEATURE.md](ADDING-A-FEATURE.md).

**1. Model** in `prisma/schema.prisma`. The model name is the table name; don't use `@@map`.
```prisma
model Customer {
  id          String    @id @default(uuid()) @db.Uuid
  code        String    @unique
  name        String
  creditLimit Decimal   @default(0) @db.Decimal(14, 2)
  // Audit columns: last, in this order, on every table (copy them, with the matching relations on User, from Product)
  creator     User?     @relation("CustomerCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  createdBy   String?
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  modifier    User?     @relation("CustomerModifiedBy", fields: [modifiedBy], references: [id], onDelete: SetNull)
  modifiedBy  String?
  modifiedAt  DateTime? @db.Timestamptz(3)
  isActive    Boolean   @default(true)
}
```
Then run `npm run db:migrate -- --name add_customers`. This creates the table and its cache trigger.

**2. Schema**: `customers.schema.ts`
```ts
export const customer = z.object({ id: z.uuid(), code: z.string(), name: z.string(), creditLimit: money, createdBy: z.string().nullable(), createdAt: z.date(), modifiedBy: z.string().nullable(), modifiedAt: z.date().nullable(), isActive: z.boolean() })
export const customerPage = pageResult(customer)
export const listCustomersQuery = pageQuery.extend({ q: z.string().trim().min(1).optional() })
```

**3. Service**: `customers.service.ts`. Plain functions that return Prisma rows as they are.
```ts
export function listCustomers({ q, ...page }: ListCustomersQuery) {
  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {}
  return paginate(page, (args) => db.customer.findMany({ where, ...args }), () => db.customer.count({ where }))
}
```

**4. Routes**: `customers.routes.ts`. Access control and caching are declared, not coded.
```ts
app.get("/", {
  schema: { querystring: listCustomersQuery, response: { 200: customerPage } },
  config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
}, (req) => listCustomers(req.query))
```

**5. Permission**: give the feature its own group in `src/platform/security/permissions.ts`, e.g. `CUSTOMERS: { VIEW: "View customers" }`. Don't reuse another screen's codes, so it can be granted separately. The `Permission` table row is created automatically at the next boot, but no role has it yet, not even Super Admin: grant it in the role editor. Add the route to the access matrix in `test/app.test.ts`.

The route is now at `/api/v1/customers`. It's in `/docs`, protected, cached, and cleared on every change to the Customer table. You don't edit `app.ts`, the error handler, any cache wiring or any trigger SQL.

## Access control

Authorization uses **permission codes**: a screen code plus a permission code, written `SCREEN.PERMISSION` (e.g. `PRODUCTS.CREATE`). They're all listed in `src/platform/security/permissions.ts`. Each route names the one it needs:

| Route config | Who can call it |
| --- | --- |
| `config: { public: true }` | anyone (login, logout, health) |
| *(nothing)* | any signed-in user |
| `config: { permission: "PRODUCTS.CREATE" }` | signed-in users who have that permission; everyone else gets 403 |

**Tables:**

| Table | Holds |
| --- | --- |
| `Permission` | one row per screen code + permission code |
| `RolePermission` | what a role grants |

**Where a user's permissions come from:** every user has exactly one role (`User.roleId` is required), and the role's permissions are the user's permissions. To change what one user can do, move them to another role. A role that still has users can't be deleted.

**Keeping the table in sync:** `src/platform/security/permissions.ts` is the source of truth. At boot, `security/permissions-sync.plugin.ts` creates any missing `Permission` rows and refreshes descriptions. Rows for codes that were removed from the file are logged as a warning and grant nothing.

**Frontend:**
- `GET /api/v1/auth/me` returns `permissions: ["PRODUCTS.VIEW", …]`. Show a screen when the user has `<SCREEN>.VIEW`, and a button when they have the matching code.
- `GET /api/v1/permissions` lists every code with its description, for the role editor's checkboxes.

**Sessions** (`platform/security/sessions.ts`):
- `POST /api/v1/auth/login { email, password }` sets an `httpOnly` cookie holding a random 256-bit session id.
- The `Session` table is the source of truth. Rows are keyed by the SHA-256 of the id, so a leaked row can't be used to sign in. `expiresAt` slides with activity (`SESSION_TTL_SECONDS`), and expired rows are deleted on the next sign-in.
- Redis keeps a copy of each session for up to 15 minutes and is read first; when the copy is missing, the table is read and the copy refreshed. If Redis is down, the table answers, so nobody is signed out by an outage.
- A session ended while Redis was unreachable can still be served from its stale copy for those 15 minutes at most.
- `POST /api/v1/auth/logout` ends the current session.

**Each request:**
- The auth hook loads the user and their role's permissions through `getCurrentUser()` (`platform/security/current-user.ts`). The result is cached in Redis against `User`, `Role`, `Permission` and `RolePermission`.
- Because of that, admin changes apply on the user's next request without them signing in again: a new role, changed grants, or deactivation (which ends the session).
- In handlers, `req.user` is `{ id, name, email, roleId, roleName, permissions }`, and `actorOf(req)` gives `{ id, sessionId }` for audit fields.

**Users** (`/api/v1/users`): viewing needs `ADMIN.VIEW`; changes need `ADMIN.MANAGE_USERS`.
- **Role:** `roleId` is required when creating a user. Responses include `roleName`.
- **Ids** are `USER00001`, `USER00002`, … from the `next_user_id()` database function. They widen past `USER99999` rather than truncating. A rolled-back insert leaves a gap.
- **Audit columns:**
  - `createdBy` + `createdAt` are set on create.
  - `modifiedBy` + `modifiedAt` are set on every change and stay null until the first one.
  - Both hold the acting user's id and are never accepted from the client.
  - The first user, created by the seed, is their own creator.
- **Delete is soft.** `DELETE /api/v1/users/:id` sets `isActive = false` and ends all of the user's sessions. The row and its history stay.
  Products and categories work the same way: `DELETE /api/v1/products/:id` (or `/categories/:id`) sets `isActive = false`, lists hide them unless `?includeInactive=true`, and `PATCH { isActive: true }` restores one. A category that active products still use can't be deleted (409).
  Product ids are `PROD000001…` and category ids `CAT0001…` (`next_product_id()` / `next_category_id()`). A product holds its current `price`, `cost` and four stock columns; creating it, or changing any of them, also records a `PriceMovement` / `CostMovement` (previous → new) or `StockMovement` (signed quantity + balance after) in the same transaction.
  Product images go straight from the browser to Cloudflare R2: `POST /api/v1/products/image-upload-url { contentType }` returns a 5-minute signed `uploadUrl` (PUT the file there with the same `Content-Type`) and the `publicUrl` to save as `imageUrl`. The bucket needs a CORS rule allowing `PUT` from the frontend origin (`R2_*` in `.env.example`).
  - Deleted users can't sign in and are hidden from `GET /api/v1/users` unless you pass `?includeInactive=true`.
  - `PATCH { isActive: true }` restores a user.
  - A deleted user's email stays taken.
- **Passwords:** `PATCH /api/v1/users/:id` with `password` replaces it and signs the user out everywhere else. An admin changing their own password stays signed in.
- **No self-lockout:** admins can't deactivate themselves, move themselves to a role without `ADMIN.MANAGE_USERS`, or remove it from their own role (`409 SELF_LOCKOUT`).

**Roles** (`/api/v1/roles`): viewing needs `ADMIN.VIEW`; changes need `ADMIN.MANAGE_ROLES`.

**Secrets:** passwords are hashed with scrypt (`platform/security/password.ts`). `passwordHash` is never loaded unless a query asks for it: `omit` in `platform/core/db.ts`.

**Frontend cookies:** axios needs `withCredentials: true`, and the API's `CORS_ORIGIN` must list the frontend's origin.

## Caching

**Default: put the cache on the route.** `config: { cache: ["Customer"] }` lists every table the response is built from. A write to any of those tables drops the cached responses.
  - Use `{ tables: [...], perUser: true }` when the response depends on who is asking.
  - Use `ttl` to override the default lifetime.

**Outside a route**, wrap the read in `cache.remember({ tables: ["Setting"], key: "settings" }, () => db...)`. It stores JSON, so return JSON-safe values. See `getSettings()` and `getCurrentUser()` for examples.

**How invalidation works:**
- Every table has a `notify_change` trigger, and `npm run db:migrate` adds it to new tables.
- After each committed write, the trigger sends the table name. That covers writes from Prisma, raw SQL, psql or another service.
- `cache/db-events.plugin.ts` receives it and bumps that table's cache version. Old entries become unreachable at once and expire through their TTL.

**Safety nets:**
- If Redis is down, reads go to the database. The server also starts without Redis and reconnects when it's back.
- If the listener connection drops, it reconnects and clears the whole cache.
- `CACHE_TTL_SECONDS` caps how long anything is cached.

**Always use `npm run db:migrate`**, never `prisma db push`, so the triggers exist.

## Errors

- Throw, don't format: `throw new NotFoundError("Customer", id)`, `ConflictError`, `BadRequestError`, or any `AppError`.
- Errors specific to one feature go in that feature's folder: `class CreditLimitExceededError extends AppError { ... }` in `customers.errors.ts`.
- Prisma errors are already mapped: duplicate value P2002 → 409, missing record P2025 → 404, foreign key P2003 → 409.
- If a handler returns data that doesn't match its response schema, the client gets a 500 and the exact mismatch is in the log.

## Business settings

- A single `Setting` row holds currency, country and timezone, created from `DEFAULT_*` on first use.
- `GET /api/v1/settings` (any signed-in user) returns the settings plus `serverTime` in UTC. `PATCH /api/v1/settings` needs `ADMIN.EDIT_SETTINGS`, and values are validated: ISO currency, ISO country, IANA timezone.
- In code: `const { currency, timezone } = await getSettings()`.
- Store timestamps in UTC. Use `timezone` only for display, reports and business-day boundaries.

## Debugging

- **Logs:** in development they're pretty-printed with a `reqId`. Set `LOG_LEVEL=debug` to see cache hit/miss and db change events, and add `PRISMA_LOG_QUERIES=true` to see every SQL query with its duration.
- **Did a response come from the cache?** Check the `x-cache` response header (HIT or MISS) in the browser's network tab.
- **Breakpoints:** `npm run dev`, then in VS Code run **Attach to npm run dev**, or use **Debug server** / **Debug current test file**.
- **API docs:** `/docs` shows each route with the permission it requires. It's served when `APP_ENV` is `development` or `staging`, not in `production`. To try routes there, log in via `/api/v1/auth/login` first; the cookie is then sent automatically. `/docs/json` can be imported into Postman.
- **Health:** `GET /api/v1/health` reports `db` and `redis` status. Overall `status` is `ok`, `degraded` (Redis down, served from the database, still 200) or `down` (database down, 503).
