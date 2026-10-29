import fp from "fastify-plugin"
import type { FastifyReply, FastifyRequest } from "fastify"
import { ForbiddenError, UnauthorizedError } from "#http/errors.js"
import type { PermissionKey } from "./permissions.js"
import { sessionCookie, sessions } from "./sessions.js"
import { getCurrentUser, type CurrentUser } from "./current-user.js"

// Secure by default: every route under /api/v1 needs a valid session unless it says otherwise.
//
//   config: { public: true }                      no session needed (login, health)
//   (nothing)                                     any signed-in user
//   config: { permission: "PRODUCTS.CREATE" }     signed-in user who has that permission → else 403
//
// In handlers: `req.user` is the signed-in user (with their effective permissions), `actorOf(req)` who is acting.

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean
    permission?: PermissionKey
  }
  interface FastifyRequest {
    /** The signed-in user. Not set on `public` routes. */
    user: CurrentUser
    /** The current session id. Not set on `public` routes. */
    sessionId: string
  }
}

/** Who is making a change: recorded in createdBy/modifiedBy, and their own session is kept on password changes. */
export interface Actor {
  id: string
  sessionId: string
}

export const actorOf = (request: FastifyRequest): Actor => ({ id: request.user.id, sessionId: request.sessionId })

/** How the request presented its session id. */
interface Credential {
  sessionId: string
  via: "cookie"
}

// The only place that knows how a client sends its session. Today that's the web's httpOnly cookie. A mobile client
// would send `Authorization: Bearer <session id>`: read it here and add `"bearer"` to Credential["via"]. Everything
// after this — session lookup, current user, permission check, Actor — is the same whichever way the id arrived.
function readCredential(request: FastifyRequest): Credential | undefined {
  const cookie = request.cookies[sessionCookie.name]
  return cookie ? { sessionId: cookie, via: "cookie" } : undefined
}

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const { public: isPublic, permission } = request.routeOptions.config
  if (isPublic) return

  const credential = readCredential(request)
  const session = credential ? await sessions.touch(credential.sessionId) : null
  if (!credential || !session) throw new UnauthorizedError()
  const { sessionId } = credential

  const user = await getCurrentUser(session.userId)
  if (!user) {
    // Deactivated since sign-in.
    await sessions.destroy(sessionId)
    throw new UnauthorizedError()
  }

  request.user = user
  request.sessionId = sessionId
  // Keep the cookie's expiry in step with the sliding session.
  if (credential.via === "cookie") reply.setCookie(sessionCookie.name, sessionId, sessionCookie.options)

  if (permission && !user.permissions.includes(permission)) {
    throw new ForbiddenError(permission)
  }
}

// Registered inside the /api/v1 scope in app.ts, so /docs stays outside it.
export default fp(
  async (app) => {
    app.decorateRequest("user", null as unknown as CurrentUser)
    app.decorateRequest("sessionId", "")
    app.addHook("onRequest", authenticate)
  },
  { name: "auth" },
)
