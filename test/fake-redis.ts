import type { Redis } from "ioredis"

// Just the Redis commands platform/cache/cache.ts uses, kept in a Map. Lets cache logic be unit-tested without a server.
export function fakeRedis() {
  const store = new Map<string, string>()
  const incr = (key: string) => {
    const next = Number(store.get(key) ?? 0) + 1
    store.set(key, String(next))
    return next
  }
  const redis = {
    store,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async mget(keys: string[]) {
      return keys.map((k) => store.get(k) ?? null)
    },
    async set(key: string, value: string) {
      store.set(key, value)
      return "OK"
    },
    pipeline() {
      const ops: (() => unknown)[] = []
      const pipe = {
        incr(key: string) {
          ops.push(() => incr(key))
          return pipe
        },
        async exec() {
          return ops.map((op) => [null, op()])
        },
      }
      return pipe
    },
  }
  return redis as typeof redis & Redis
}
