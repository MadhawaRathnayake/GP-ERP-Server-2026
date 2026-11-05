import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createEventStreamGroup, openEventStream, type EventStreamOptions } from "./event-stream.js"

// Real HTTP server and fetch: hijacked streaming responses can't be tested with app.inject().

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** Serves GET /events from inside a plugin (like a module's routes) and returns its URL and stream group. */
async function serve(options: EventStreamOptions = {}) {
  const group = createEventStreamGroup()
  app = Fastify()
  await app.register(async (scope) => {
    scope.addHook("onRequest", async (_, reply) => {
      reply.header("access-control-allow-origin", "http://localhost:5173")
    })
    scope.addHook("preClose", async () => group.closeAll())
    scope.get("/events", async (req, reply) => {
      group.add(openEventStream(req, reply, options))
      return reply
    })
  })
  const address = await app.listen({ port: 0, host: "127.0.0.1" })
  return { url: `${address}/events`, group }
}

/** Reads the response body until `done(text)` holds or the stream ends; returns everything read. */
async function readUntil(body: ReadableStream<Uint8Array>, done: (text: string) => boolean = () => false) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (!done(text)) {
    const { value, done: ended } = await reader.read()
    if (ended) break
    text += decoder.decode(value, { stream: true })
  }
  reader.releaseLock()
  return text
}

/** Waits until `check()` holds, polling every few milliseconds. */
async function until(check: () => boolean) {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe("openEventStream", () => {
  it("sends event-stream headers, keeps headers set earlier, and writes events as JSON", async () => {
    const { url, group } = await serve()
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8")
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(res.headers.get("x-accel-buffering")).toBe("no")
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")

    await until(() => group.size === 1)
    group.broadcast("stock", { id: "PROD000001", stockInHand: 4 })
    const text = await readUntil(res.body!, (t) => t.includes("\n\nevent: stock"))
    expect(text).toContain("retry: 3000\n\n")
    expect(text).toMatch(/event: stock\ndata: \{"id":"PROD000001","stockInHand":4\}\n\n$/)
  })

  it("sends heartbeats while access holds and ends the stream once it doesn't", async () => {
    let allowed = true
    const { url } = await serve({ heartbeatMs: 10, isAllowed: async () => allowed })
    const res = await fetch(url)
    expect(await readUntil(res.body!, (t) => t.includes(": ping\n\n"))).toContain(": ping")

    allowed = false
    await readUntil(res.body!) // resolves only when the server ends the response
  })

  it("ends the stream when the access check throws", async () => {
    const { url, group } = await serve({ heartbeatMs: 10, isAllowed: () => Promise.reject(new Error("db down")) })
    const res = await fetch(url)
    await readUntil(res.body!)
    expect(group.size).toBe(0)
  })

  it("forgets a stream when the client disconnects", async () => {
    const { url, group } = await serve()
    const abort = new AbortController()
    await fetch(url, { signal: abort.signal })
    await until(() => group.size === 1)
    abort.abort()
    await until(() => group.size === 0)
  })

  it("lets the server shut down with streams open (preClose)", async () => {
    const { url, group } = await serve()
    const res = await fetch(url)
    await until(() => group.size === 1)
    await app!.close()
    app = undefined
    await readUntil(res.body!)
    expect(group.size).toBe(0)
  })
})
