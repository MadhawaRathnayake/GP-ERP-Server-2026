import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { createEventStreamGroup, openEventStream, type EventStream } from "#http/event-stream.js"
import { isStillAuthorized } from "#security/auth.plugin.js"
import { getCurrentUser } from "#security/current-user.js"
import type { PermissionKey } from "#security/permissions.js"
import { watchInvoiceChanges } from "#modules/invoices/invoices.events.js"
import { watchQuotationChanges } from "#modules/quotations/quotations.events.js"
import { watchStockChanges } from "#modules/stock/stock.events.js"
import { stockLevel } from "#modules/stock/stock.schema.js"

// The app's one live stream: everything kept live in the browser comes through it, so a tab holds one connection
// (browsers allow about six per site over HTTP/1.1). Each event goes only to users with the permission to read what it
// is about; their permissions are reloaded every heartbeat, so a role change applies within 25 s.
const routes: FastifyPluginAsyncZod = async (app) => {
  // Every browser tab connected to this server, and what its user may see.
  const streams = createEventStreamGroup()
  const permissions = new WeakMap<EventStream, ReadonlySet<PermissionKey>>()
  const send = (event: string, data: unknown, permission: PermissionKey) =>
    streams.broadcast(event, data, (stream) => permissions.get(stream)?.has(permission) ?? false)

  const stopStock = await watchStockChanges({
    onChange: (level) => send("stock", z.encode(stockLevel, level), "PRODUCTS.VIEW"),
    // Sent after the database connection comes back, when every watcher may have missed changes, not only stock's.
    onMissed: () => streams.broadcast("resync", {}),
  })
  const stopInvoices = await watchInvoiceChanges((id) => send("invoice", { id }, "INVOICES.VIEW"))
  const stopQuotations = await watchQuotationChanges((id) => send("quotation", { id }, "QUOTATIONS.VIEW"))
  // Before the server waits for open requests to finish, which a stream never does on its own.
  app.addHook("preClose", async () => streams.closeAll())
  app.addHook("onClose", async () => {
    stopStock()
    stopInvoices()
    stopQuotations()
  })

  app.get(
    "/",
    {
      schema: {
        description: [
          "Server-sent events (`text/event-stream`, read with `EventSource`) for any signed-in user. Stays open; the server re-checks the session every heartbeat. Each event reaches only users with the permission named.",
          "- `stock` (PRODUCTS.VIEW): a product's new stock, same shape as an item of `GET /api/v1/stock`. Keep the value with the higher `stockVersion`.",
          "- `invoice` (INVOICES.VIEW): `{ id }` of an invoice that was created or changed; reload it with `GET /api/v1/invoices/by-ids`.",
          "- `quotation` (QUOTATIONS.VIEW): `{ id }` of a quotation that was created, changed or deleted; reload it with `GET /api/v1/quotations/by-ids`.",
          "- `resync`: changes may have been missed; reload what you keep live (`GET /api/v1/stock`, the newest invoices and quotations).",
        ].join("\n"),
      },
    },
    async (req, reply) => {
      const stream = openEventStream(req, reply, {
        isAllowed: async () => {
          if (!(await isStillAuthorized(req))) return false
          const user = await getCurrentUser(req.user.id)
          if (!user) return false
          permissions.set(stream, new Set(user.permissions))
          return true
        },
      })
      permissions.set(stream, new Set(req.user.permissions))
      streams.add(stream)
      return reply
    },
  )
}

export default routes
