import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { createEventStreamGroup, openEventStream } from "#http/event-stream.js"
import { isStillAuthorized } from "#security/auth.plugin.js"
import { watchStockChanges } from "./stock.events.js"
import { stockLevel, stockLevels } from "./stock.schema.js"
import { listStockLevels } from "./stock.service.js"

// Stock is product data, so it needs PRODUCTS.VIEW like GET /products, which returns the same columns.
const routes: FastifyPluginAsyncZod = async (app) => {
  // Every browser watching stock through this server.
  const watchers = createEventStreamGroup()
  const stopWatching = await watchStockChanges({
    onChange: (level) => watchers.broadcast("stock", z.encode(stockLevel, level)),
    onMissed: () => watchers.broadcast("resync", {}),
  })
  // Before the server waits for open requests to finish, which a stream never does on its own.
  app.addHook("preClose", async () => watchers.closeAll())
  app.addHook("onClose", async () => stopWatching())

  // Not cached: a cached copy could be older than changes a client already received on the stream.
  app.get(
    "/",
    {
      schema: {
        description: "Current stock of every active product. Load it whenever the event stream (re)connects or sends `resync`.",
        response: { 200: stockLevels },
      },
      config: { permission: "PRODUCTS.VIEW" },
    },
    () => listStockLevels(),
  )

  app.get(
    "/events",
    {
      schema: {
        description: [
          "Server-sent events (`text/event-stream`, read with `EventSource`). Stays open; the server re-checks access every heartbeat.",
          "- `stock`: a product's new stock, same shape as an item of `GET /api/v1/stock`. Keep the value with the higher `stockVersion`.",
          "- `resync`: changes may have been missed; reload `GET /api/v1/stock`.",
        ].join("\n"),
      },
      config: { permission: "PRODUCTS.VIEW" },
    },
    async (req, reply) => {
      watchers.add(openEventStream(req, reply, { isAllowed: () => isStillAuthorized(req) }))
      return reply
    },
  )
}

export default routes
