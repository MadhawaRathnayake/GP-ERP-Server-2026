import { pino } from "pino"
import { env } from "#config/env.js"

// The one logger. Fastify uses it for request logs (each line gets reqId); import it anywhere else.
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } },
  }),
})
