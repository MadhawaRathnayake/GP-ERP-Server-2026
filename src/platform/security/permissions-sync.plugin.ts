import fp from "fastify-plugin"
import { syncPermissions } from "./permission-table.js"

// Makes the Permission table match platform/security/permissions.ts before the server takes requests.
export default fp(
  async (app) => {
    const { created, updated, obsolete } = await syncPermissions()
    if (created.length > 0 || updated.length > 0) app.log.info({ created, updated }, "permissions synced")
    if (obsolete.length > 0) {
      app.log.warn({ obsolete }, "permissions in the database are no longer defined in code; they grant nothing and can be deleted")
    }
  },
  { name: "permissions-sync", dependencies: ["connections"] },
)
