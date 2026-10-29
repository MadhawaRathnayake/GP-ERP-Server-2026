import { createHash, randomBytes } from "node:crypto"
import type { CookieSerializeOptions } from "@fastify/cookie"
import { env } from "#config/env.js"
import { db } from "#core/db.js"
import { logger } from "#core/logger.js"
import { redis } from "#core/redis.js"

// Server-side sessions. The browser only holds a random 256-bit id in an httpOnly cookie.
//   Session table          → { id: sha256(cookie id), userId, createdAt, expiresAt }   the source of truth
//   session:<sha256 id>    → { userId, createdAt }   Redis copy, read first, at most CACHE_TTL seconds old
// Rows are keyed by the hash, so a leaked row can't be used to sign in.
// Redis is only a cache here: when it's down or has no copy, the table answers, so nobody is signed out by an outage.
// expiresAt slides SESSION_TTL_SECONDS ahead each time the table is read (about every CACHE_TTL while active).
// Expired rows are deleted on the next sign-in.

export interface Session {
  userId: string
  createdAt: string
}

const ttl = env.SESSION_TTL_SECONDS
// Also how long a session ended while Redis was unreachable can still be served from its stale copy.
const CACHE_TTL = Math.min(15 * 60, ttl)

const hash = (id: string) => createHash("sha256").update(id).digest("base64url")
const cacheKey = (hashedId: string) => `session:${hashedId}`
const expiresAt = () => new Date(Date.now() + ttl * 1000)
const log = logger.child({ module: "sessions" })

// Redis failures are logged and never thrown: the table takes over.
const cached = {
  async get(hashedId: string): Promise<Session | null> {
    try {
      const raw = await redis.get(cacheKey(hashedId))
      return raw ? (JSON.parse(raw) as Session) : null
    } catch (err) {
      log.warn({ err }, "session cache read failed, using the database")
      return null
    }
  },
  async set(hashedId: string, session: Session): Promise<void> {
    await redis.set(cacheKey(hashedId), JSON.stringify(session), "EX", CACHE_TTL).catch((err) => log.warn({ err }, "session cache write failed"))
  },
  async del(hashedIds: string[]): Promise<void> {
    if (hashedIds.length === 0) return
    await redis.del(...hashedIds.map(cacheKey)).catch((err) => log.warn({ err }, "session cache delete failed"))
  },
}

export const sessions = {
  async create(userId: string): Promise<string> {
    const id = randomBytes(32).toString("base64url")
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    const row = await db.session.create({ data: { id: hash(id), userId, expiresAt: expiresAt() } })
    await cached.set(row.id, { userId, createdAt: row.createdAt.toISOString() })
    return id
  },

  /** Returns the session and extends its expiry (sliding sessions). */
  async touch(id: string): Promise<Session | null> {
    const hashedId = hash(id)
    const hit = await cached.get(hashedId)
    if (hit) return hit

    const [row] = await db.session.updateManyAndReturn({
      where: { id: hashedId, expiresAt: { gt: new Date() } },
      data: { expiresAt: expiresAt() },
      select: { userId: true, createdAt: true },
    })
    if (!row) return null
    const session: Session = { userId: row.userId, createdAt: row.createdAt.toISOString() }
    await cached.set(hashedId, session)
    return session
  },

  async destroy(id: string): Promise<void> {
    const hashedId = hash(id)
    await db.session.deleteMany({ where: { id: hashedId } })
    await cached.del([hashedId])
  },

  /** Signs a user out everywhere, optionally keeping one session (the caller's own). */
  async destroyAllForUser(userId: string, { except }: { except?: string } = {}): Promise<void> {
    const rows = await db.session.findMany({ where: { userId, id: { not: except ? hash(except) : undefined } }, select: { id: true } })
    const hashedIds = rows.map((r) => r.id)
    if (hashedIds.length === 0) return
    await db.session.deleteMany({ where: { id: { in: hashedIds } } })
    await cached.del(hashedIds)
  },
}

const baseCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: env.COOKIE_SAMESITE,
  secure: env.COOKIE_SECURE,
} satisfies CookieSerializeOptions

export const sessionCookie = {
  name: env.SESSION_COOKIE_NAME,
  /** For reply.setCookie() */
  options: { ...baseCookieOptions, maxAge: ttl } satisfies CookieSerializeOptions,
  /** For reply.clearCookie() */
  clearOptions: baseCookieOptions,
}
