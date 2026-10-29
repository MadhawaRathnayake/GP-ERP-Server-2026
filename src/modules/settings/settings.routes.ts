import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { settingsResponse, updateSettingsBody } from "./settings.schema.js"
import { getSettings, updateSettings } from "./settings.service.js"

const withServerTime = <T>(settings: T) => ({ ...settings, serverTime: new Date().toISOString() })

const routes: FastifyPluginAsyncZod = async (app) => {
  // PLACEHOLDER: any signed-in user can read settings. Make it `config: { public: true }` if the login page needs them.
  app.get("/", { schema: { response: { 200: settingsResponse } } }, async () => withServerTime(await getSettings()))

  app.patch(
    "/",
    {
      schema: { body: updateSettingsBody, response: { 200: settingsResponse } },
      config: { permission: "ADMIN.EDIT_SETTINGS" },
    },
    async (req) => withServerTime(await updateSettings(req.body, actorOf(req))),
  )
}

export default routes
