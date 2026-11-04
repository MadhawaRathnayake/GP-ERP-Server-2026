import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { dropdownCodeParams, updateUserDropdownBody, userDropdown, userDropdownList } from "./dropdowns.schema.js"
import { listUserDropdowns, updateUserDropdown } from "./dropdowns.service.js"

// The configuration, for the admin screen. Features serve their own dropdown's users (e.g. GET /quotations/sales-managers),
// under their own permission, so using a dropdown doesn't need DROPDOWNS.VIEW.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { response: { 200: userDropdownList } },
      config: { permission: "DROPDOWNS.VIEW", cache: ["UserDropdown"] },
    },
    () => listUserDropdowns(),
  )

  app.patch(
    "/:code",
    {
      schema: { params: dropdownCodeParams, body: updateUserDropdownBody, response: { 200: userDropdown } },
      config: { permission: "DROPDOWNS.EDIT" },
    },
    (req) => updateUserDropdown(req.params.code, req.body, actorOf(req)),
  )
}

export default routes
