import { describe, expect, it, vi } from "vitest"
import { pino } from "pino"
import { Cache } from "./cache.js"
import { fakeRedis } from "#test/fake-redis.js"

const setup = () => {
  const redis = fakeRedis()
  return { redis, cache: new Cache(redis, pino({ level: "silent" }), 60) }
}

describe("Cache", () => {
  it("loads once, then serves from cache", async () => {
    const { cache } = setup()
    const load = vi.fn(async () => ({ total: 1 }))

    expect(await cache.remember({ tables: ["Product"], key: "list" }, load)).toEqual({ total: 1 })
    expect(await cache.remember({ tables: ["Product"], key: "list" }, load)).toEqual({ total: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("reloads after one of its tables is invalidated", async () => {
    const { cache } = setup()
    let version = 1
    const load = vi.fn(async () => version)

    await cache.remember({ tables: ["Account", "Role"], key: "user" }, load)
    version = 2
    await cache.invalidate("Role")

    expect(await cache.remember({ tables: ["Account", "Role"], key: "user" }, load)).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("leaves entries for other tables cached", async () => {
    const { cache } = setup()
    const load = vi.fn(async () => "customers")

    await cache.remember({ tables: ["Customer"], key: "all" }, load)
    await cache.invalidate("Product")
    await cache.remember({ tables: ["Customer"], key: "all" }, load)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it("invalidateAll drops every entry", async () => {
    const { cache } = setup()
    const load = vi.fn(async () => "x")

    await cache.remember({ tables: ["Customer"], key: "all" }, load)
    await cache.invalidateAll()
    await cache.remember({ tables: ["Customer"], key: "all" }, load)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it("caches null results (e.g. not found) until invalidated", async () => {
    const { cache } = setup()
    const load = vi.fn(async () => null)

    expect(await cache.remember({ tables: ["Product"], key: "id:x" }, load)).toBeNull()
    expect(await cache.remember({ tables: ["Product"], key: "id:x" }, load)).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("falls back to the loader when Redis fails", async () => {
    const { redis, cache } = setup()
    redis.mget = async () => {
      throw new Error("connection refused")
    }

    expect(await cache.remember({ tables: ["Product"], key: "list" }, async () => "from db")).toBe("from db")
  })
})
