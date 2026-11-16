import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { COUNTRIES } from "./countries.js"
import { countryList } from "./countries.schema.js"

// The countries a customer, supplier or the company settings can have, for the selects. Any signed-in user.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get("/", { schema: { response: { 200: countryList } } }, () => COUNTRIES)
}

export default routes
