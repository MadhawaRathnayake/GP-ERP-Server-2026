import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sessionCookie } from "#security/sessions.js"
import { currentUser } from "#security/current-user.js"
import { loginBody } from "./auth.schema.js"
import { login, logout } from "./auth.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  // PLACEHOLDER: add brute-force protection here before going live (e.g. @fastify/rate-limit, ~5 attempts/min per IP + email).
  app.post("/login", { schema: { body: loginBody, response: { 200: currentUser } }, config: { public: true } }, async (req, reply) => {
    const { sessionId, user } = await login(req.body)
    reply.setCookie(sessionCookie.name, sessionId, sessionCookie.options)
    return user
  })

  // Public so it always clears the cookie, even when the session has already expired.
  app.post("/logout", { config: { public: true } }, async (req, reply) => {
    const sessionId = req.cookies[sessionCookie.name]
    if (sessionId) await logout(sessionId)
    return reply.clearCookie(sessionCookie.name, sessionCookie.clearOptions).status(204).send()
  })

  app.get("/me", { schema: { response: { 200: currentUser } } }, (req) => req.user)
}

export default routes
