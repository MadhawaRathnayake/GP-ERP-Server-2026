import { buildApp, type App } from "./app.js"
import { env } from "#config/env.js"
import { logger } from "#core/logger.js"

let app: App
try {
  app = await buildApp()
  await app.listen({ host: env.HOST, port: env.PORT })
  app.log.info(`API docs: http://localhost:${env.PORT}/docs`)
} catch (err) {
  // Usually Postgres unreachable or wrong credentials in .env (DATABASE_URL). Redis being down doesn't stop startup.
  logger.fatal({ err }, "failed to start")
  process.exit(1)
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down")
  await app.close()
  process.exit(0)
}
process.once("SIGINT", () => void shutdown("SIGINT"))
process.once("SIGTERM", () => void shutdown("SIGTERM"))
