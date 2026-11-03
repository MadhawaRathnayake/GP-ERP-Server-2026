# Logging

**Logs are not stored.** The server prints them to the terminal it runs in (standard output), and they're gone when
the terminal closes. There's no log file and no log service.

- One logger for everything: `src/platform/core/logger.ts` (pino). `app.log`, `request.log` and `logger` are all it.
- `npm run dev` (`NODE_ENV=development`): readable lines with times like `09:43:02.123`. Otherwise one JSON object per
  line.
- Each request's lines carry its `reqId`, the same value as the response's `x-request-id` header and the `requestId`
  in error bodies. Search for it to find what happened to one request.

## How much is logged

| Setting | Effect |
|---|---|
| `LOG_LEVEL` | Lowest level shown: `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` or `silent`. `.env.example` uses `debug` |
| `PRISMA_LOG_QUERIES=true` | Logs every SQL query with its duration, at `debug` (so `LOG_LEVEL` must be `debug` or lower) |

What you'll see at `info`: server start, `listening for db changes`, `permissions synced` (only when a permission was
created or its description changed), and two lines per request (`incoming request`, `request completed` with the
status and time). At `warn`: Redis problems, obsolete permissions. At
`debug`: cache hits and misses.

## Keeping logs

- Quick, no code change: `npm run dev > server.log 2>&1`. The dev format includes colour codes.
- In production, let the process manager or host keep standard output (Docker, PM2, systemd).
- Writing to a file or a log service from the app is a change to `src/platform/core/logger.ts`, which is platform
  code: agree on it first.
