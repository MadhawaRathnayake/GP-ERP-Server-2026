import type { FastifyReply, FastifyRequest } from "fastify"

// Server-sent events (text/event-stream): a GET response that stays open and gets events written to it, e.g. live
// stock. Browsers read it with EventSource, which reconnects on its own when the connection drops.
//
//   const stream = openEventStream(req, reply, { isAllowed: () => isStillAuthorized(req) })
//   stream.send("stock", { … })
//
// The route's normal access check (auth.plugin.ts) has run by then. A stream stays open for hours, so `isAllowed`
// checks access again before every heartbeat and ends the stream once it fails or throws.

/** Below the 30–60 s after which proxies and load balancers usually drop a silent connection. */
const HEARTBEAT_MS = 25_000
/** How long EventSource waits before reconnecting after the connection drops. */
const RETRY_MS = 3_000

export interface EventStream {
  /** Sends one event; `data` is sent as JSON. Does nothing once the stream has ended. */
  send(event: string, data: unknown): void
  close(): void
  /** Runs `listener` once when the stream ends, whichever side ended it (at once if it already has). */
  onClose(listener: () => void): void
}

export interface EventStreamOptions {
  isAllowed?: () => Promise<boolean>
  heartbeatMs?: number
}

export function openEventStream(
  request: FastifyRequest,
  reply: FastifyReply,
  { isAllowed, heartbeatMs = HEARTBEAT_MS }: EventStreamOptions = {},
): EventStream {
  // From here on the route writes the response itself and Fastify's onSend hooks are skipped, so the headers set so far
  // (CORS, by @fastify/cors) are copied by hand. The session cookie isn't refreshed: the stream doesn't count as activity.
  reply.hijack()
  const res = reply.raw
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) res.setHeader(name, value)
  }
  res.writeHead(200, {
    "x-request-id": request.id,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // nginx buffers responses by default, which would hold the events back.
    "x-accel-buffering": "no",
  })
  res.write(`retry: ${RETRY_MS}\n\n`)
  request.log.debug("event stream opened")

  const closeListeners = new Set<() => void>()
  let closed = false
  let checking = false

  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    res.end()
    for (const listener of closeListeners) listener()
    closeListeners.clear()
    request.log.debug("event stream closed")
  }

  const beat = async () => {
    if (isAllowed && !(await isAllowed())) return close()
    if (!closed) res.write(": ping\n\n")
  }

  const heartbeat = setInterval(() => {
    // A slow access check (database under load) must not pile up behind the next one.
    if (checking) return
    checking = true
    beat()
      .catch((err: unknown) => {
        request.log.warn({ err }, "event stream access check failed, closing it")
        close()
      })
      .finally(() => {
        checking = false
      })
  }, heartbeatMs)

  // The browser closed the page or lost the connection.
  res.on("close", close)

  return {
    send(event, data) {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    close,
    onClose(listener) {
      if (closed) listener()
      else closeListeners.add(listener)
    },
  }
}

/** Open streams that all get the same events, e.g. every browser watching stock. A stream leaves when it ends. */
export function createEventStreamGroup() {
  const streams = new Set<EventStream>()
  return {
    add(stream: EventStream) {
      streams.add(stream)
      stream.onClose(() => streams.delete(stream))
    },
    broadcast(event: string, data: unknown) {
      for (const stream of streams) stream.send(event, data)
    },
    /** Ends every stream, e.g. on shutdown: open streams would keep the server from closing. */
    closeAll() {
      for (const stream of [...streams]) stream.close()
    },
    get size() {
      return streams.size
    },
  }
}

export type EventStreamGroup = ReturnType<typeof createEventStreamGroup>
