# What happens automatically

Things that run without anyone calling them. If something "just works", it's probably here.

## At server start

| What | Where | Effect |
|---|---|---|
| Environment check | `src/config/env.ts` | Every variable is validated; a missing or wrong one stops the server with a message |
| Database connection | `src/platform/core/connections.plugin.ts` | Required: the server doesn't start without Postgres |
| Redis connection | same | Optional: the server starts without it and keeps retrying |
| Permission sync | `src/platform/security/permissions-sync.plugin.ts` | Creates a `Permission` row for every code in `permissions.ts` and updates changed descriptions |
| Routes | `src/app.ts` | Every `src/modules/<name>/<name>.routes.ts` is mounted at `/api/v1/<name>` |
| API docs | `src/platform/http/swagger.plugin.ts` | `/docs`, except when `APP_ENV=production` |

### Permissions

- A new permission reaches **Super Admin** at once: it's the system role (`Role.isSystem`), which has every permission
  in code, whatever its grant rows say. Every other role gets it only when an admin ticks it in Admin → Roles.
- The system role can't be renamed or have its permissions changed (409 `SYSTEM_ROLE`), and the last active user with
  it can't be deleted or moved to another role (409 `LAST_SUPER_ADMIN`).
- If everyone is locked out anyway, someone with server access runs `npm run admin:restore -- <email>`: it gives that
  user Super Admin and reactivates them. There's no API for it.
- A permission removed from `permissions.ts` stays in the table; it grants nothing and is logged as a warning at
  every start.
- Users get permission changes on their next request; they don't need to sign in again.

## Cache invalidation

- Every table has a `<Table>_notify_change` trigger. After any committed write (from the app, SQL, psql or another
  service) Postgres sends the table name on the `db_change` channel.
- `src/platform/cache/db-events.plugin.ts` listens and clears every cached response built from that table.
- GET routes are cached when they declare `config: { cache: ["Table", …] }`. The response header `x-cache` says `HIT`
  or `MISS`.
- Entries also expire after `CACHE_TTL_SECONDS` (default 1 hour) as a safety net.
- If the listener reconnects after losing its connection, it clears the whole cache, since it may have missed changes.
- A table without the trigger is never cleared: cached responses stay stale until the TTL.

## Live stock

Two triggers on `Product` (migration `20261105090000_product_stock_version`):

- `Product_set_stock_version`: when an UPDATE changes any of the four stock columns, sets `stockVersion` to the next
  value of `stock_version_seq` (one counter for all products). An update that leaves stock as it was keeps its version.
  A new product starts at 0.
- `Product_notify_stock_change`: after a version change, sends the product's id, four stock columns and
  `stockVersion` as JSON on channel `stock_change`. Postgres delivers it when the transaction commits; a rollback
  sends nothing.

Then, on every server instance:

- `db-events.plugin.ts` LISTENs on `stock_change` too (`listenTo`, same connection as the cache) and emits it.
- `modules/stock/stock.events.ts` validates the payload; `stock.routes.ts` sends it as an `event: stock` to every open
  `GET /api/v1/stock/events` stream. An invalid payload is logged and dropped.
- After db-events reconnects, every stream gets `event: resync`: notifications sent while it was disconnected are lost,
  so clients reload `GET /api/v1/stock`.
- Each stream sends a `: ping` comment every 25 s (keeps proxies from dropping it) and first re-checks the session and
  `PRODUCTS.VIEW` without extending the session. Signed out, deactivated or permission removed → the stream ends
  within 25 s. A failing check (database down) also ends it; the browser reconnects through the normal access check.
- On shutdown (`preClose`) every stream is ended, so the server doesn't wait for them.

## Document numbers

Numbers that restart every month or count per branch come from the `NumberSequence` table (migration
`20261109120000_number_sequence`); numbers that never restart use a Postgres sequence instead (`quotation_number_seq`).

- `next_sequence_value(code, period, branch)` returns the next value of one sequence, starting at 1. `code` names it
  (`invoice.draft`, `invoice.final`); `period` (`26NOV`) and `branch` (`Role.branchCode`) give each month and branch
  its own count, `''` when a sequence doesn't use one. A new month or branch gets its row on first use: no cron job.
- The upsert locks the row until the transaction commits, so two documents never get the same number; call it in the
  transaction that saves the document, and a rollback gives the value back.
- Each screen wraps it in a function that builds its format, e.g. `next_invoice_number()` → `26NOV_GP01_14`.
- Never lower a value or delete a row: the next number would be one an existing document already has.

## Sessions

- Signing in sets an httpOnly cookie (`SESSION_COOKIE_NAME`, default `sid`) holding a random id. The database stores
  only its SHA-256 hash, so a leaked row can't be used to sign in.
- Sessions expire after `SESSION_TTL_SECONDS` (default 8 hours) **without activity**: each use pushes the expiry
  forward.
- Expired session rows are deleted at the next sign-in by anyone.
- Deleting a user ends all their sessions at once.

## When Redis is down

Nothing breaks; it's only slower.

- Cached routes load from the database.
- Sessions are read from the `Session` table, so nobody is signed out.
- Warnings appear in the log (`redis unavailable`, `cache read failed`).
- To clear the cache by hand afterwards: `redis-cli INCR "cache:ver:*"`.

## On every request

- `src/platform/security/auth.plugin.ts` checks the session (401 without one) and the route's `permission` (403
  without it), before any cached response is served.
- Request bodies, queries and params are validated by the route's zod schema (400 `VALIDATION_ERROR`), and unknown
  keys are dropped.
- Responses are shaped by the response schema: columns it doesn't list are never sent.
- Every error becomes `{ error: { code, message, details?, requestId } }`, and the response has an `x-request-id`
  header to find it in the log.
