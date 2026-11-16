import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { stockLevels } from "./stock.schema.js"
import { listStockLevels } from "./stock.service.js"

// Stock is product data, so it needs PRODUCTS.VIEW like GET /products, which returns the same columns. Its changes are
// pushed on the app's live stream (modules/events).
const routes: FastifyPluginAsyncZod = async (app) => {
  // Not cached: a cached copy could be older than changes a client already received on the stream.
  app.get(
    "/",
    {
      schema: {
        description:
          "Current stock of every active product. Load it whenever the event stream (`GET /api/v1/events`) (re)connects or sends `resync`.",
        response: { 200: stockLevels },
      },
      config: { permission: "PRODUCTS.VIEW" },
    },
    () => listStockLevels(),
  )
}

export default routes
