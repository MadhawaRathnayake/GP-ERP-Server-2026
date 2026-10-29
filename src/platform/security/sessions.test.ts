import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "#core/db.js"
import { redis } from "#core/redis.js"
import { sessions } from "./sessions.js"

vi.mock("#core/redis.js", () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock("#core/db.js", () => ({
  db: { session: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), updateManyAndReturn: vi.fn() } },
}))

const createdAt = new Date("2026-01-01T00:00:00Z")
const session = { userId: "USER00001", createdAt: createdAt.toISOString() }
const redisDown = () => Promise.reject(new Error("Stream isn't writeable"))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(redis.set).mockResolvedValue("OK")
  vi.mocked(redis.del).mockResolvedValue(1)
})

describe("sessions.create", () => {
  it("saves to the database even when Redis is down", async () => {
    vi.mocked(redis.set).mockImplementation(redisDown)
    vi.mocked(db.session.create).mockResolvedValue({ id: "h", userId: session.userId, createdAt, expiresAt: createdAt })

    expect(await sessions.create(session.userId)).toEqual(expect.any(String))
    expect(db.session.create).toHaveBeenCalledOnce()
  })
})

describe("sessions.touch", () => {
  it("serves the Redis copy without touching the database", async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(session))

    expect(await sessions.touch("abc")).toEqual(session)
    expect(db.session.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it("falls back to the database when Redis has no copy, and caches the result", async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(db.session.updateManyAndReturn).mockResolvedValue([{ userId: session.userId, createdAt }] as never)

    expect(await sessions.touch("abc")).toEqual(session)
    expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^session:/), JSON.stringify(session), "EX", expect.any(Number))
  })

  it("falls back to the database when Redis is down", async () => {
    vi.mocked(redis.get).mockImplementation(redisDown)
    vi.mocked(redis.set).mockImplementation(redisDown)
    vi.mocked(db.session.updateManyAndReturn).mockResolvedValue([{ userId: session.userId, createdAt }] as never)

    expect(await sessions.touch("abc")).toEqual(session)
  })

  it("returns null for an unknown or expired session", async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(db.session.updateManyAndReturn).mockResolvedValue([])

    expect(await sessions.touch("abc")).toBeNull()
  })
})

describe("sessions.destroy", () => {
  it("deletes from the database even when Redis is down", async () => {
    vi.mocked(redis.del).mockImplementation(redisDown)

    await sessions.destroy("abc")
    expect(db.session.deleteMany).toHaveBeenCalledOnce()
  })
})
