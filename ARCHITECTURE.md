# Architecture

A **modular monolith**: one codebase, one database and one deploy, split inside into layers with strict dependency
rules. This keeps day-to-day work simple and leaves room for more clients (web, mobile), outside systems (social media,
push, email) and background work, without rewriting what already exists.

For how to add an API, permissions, caching and errors, see the [README](README.md).

## Layers

```
                 ┌──────────────────────── Clients ─────────────────────────┐
   Web (React) ── cookie        Mobile app ── bearer token*      Webhooks* ── signed request
                 └──────────────────────────────┬───────────────────────────┘
                                                ▼
 ┌─ HTTP: app.ts, mounted under /api/v1 ─────────────────────────────────────┐   ┌─ Worker* ─────────┐
 │  auth: credential → session → current user → permission check → Actor     │   │ background jobs   │
 └─────────────────────────────────┬─────────────────────────────────────────┘   └────────┬──────────┘
                                   ▼                                                      ▼
 ┌─ modules/ — business capabilities ────────────────────────────────────────────────────────────────┐
 │  products · customers · users · roles · settings · auth · permissions · health                     │
 │  services hold the business rules and know nothing about HTTP, cookies or who called them          │
 └─────────────────┬──────────────────────────────────────────────────────┬───────────────────────────┘
                   ▼                                                      ▼
 ┌─ platform/ — how the app works ─────────────────────┐   ┌─ integrations/* — outside systems ───────┐
 │  core · cache · http · security                     │   │  one adapter per provider                │
 └─────────────────────────────────────────────────────┘   └──────────────────────────────────────────┘
                                                            * not built yet, see "Extending" below
```

## Folders

```
src/
├─ server.ts           HTTP process entry point. A future worker.ts sits next to it.
├─ app.ts              builds the HTTP app: platform plugins in order, then every module under /api/v1
├─ config/env.ts       every setting from .env, validated at boot
├─ platform/           HOW the app works: no business rules, rarely edited
│  ├─ core/            db · redis · logger · connections.plugin
│  ├─ cache/           cache · route-cache.plugin · db-events.plugin
│  ├─ http/            api-version · errors · pagination · fields · error-handler.plugin · swagger.plugin
│  └─ security/        permissions (codes) · permission-table · current-user · sessions · password ·
│                      auth.plugin · permissions-sync.plugin
├─ modules/<name>/     WHAT the app does: one folder per business capability, mounted at /api/v1/<name>
└─ generated/          Prisma client (never edited)
```

**Naming:** `*.plugin.ts` is a Fastify plugin, registered in `app.ts`, that hooks into requests or into startup and
shutdown. Every other file exports plain functions, values or types.

## Rules

| # | Rule | Why | Enforced by |
|---|---|---|---|
| 1 | Dependencies only point downwards: `modules → platform`, and inside platform everything may use `core`. | The foundation stays stable, and a change to a feature can't break the platform. | ESLint (`eslint.config.js`) |
| 2 | `platform/` never imports `modules/` or `app.ts`. | No circular dependencies. Shared code moves into platform. | ESLint |
| 3 | `platform/core/` imports only `#config` and `#generated`. | You can debug the connections and the logger on their own. | ESLint |
| 4 | Cross-folder imports use a `#alias`, and same-folder imports use `./`. No `../`. | Moving a file never breaks other files' imports, and you can see where something comes from. | ESLint |
| 5 | Services never touch `request`/`reply`. They take plain arguments and an `Actor`. | A route, a job and a webhook can call the same function. | review |
| 6 | One module may use another module's service functions or errors, never its routes or internals. | Modules stay replaceable. | review |
| 7 | Only `platform/security/auth.plugin.ts` → `readCredential()` knows how a client sends its session. | Adding a new way to sign in touches one function. | review |

The aliases are defined in `package.json` → `imports`. The `development` condition points them at the `.ts` sources
for `tsc`, `tsx` and vitest, and plain `node` in production gets `dist/`. Every entry point therefore runs with
`tsx --conditions=development`, which the npm scripts and `.vscode/launch.json` already do. A new folder under
`src/platform/` or `src/` needs one new line in `imports`.

## Who is acting: the Actor

Every request that isn't `public` goes through the same steps, whichever client sent it:

```
readCredential(request)       cookie today; later also "Authorization: Bearer"
  → sessions.touch(id)        Redis copy, else the Session table; sliding expiry; revocable
  → getCurrentUser(userId)    user + role permissions, cached, cleared on any change to User/Role/Permission
  → permission check          config: { permission } on the route → 403
  → req.user, actorOf(req)    { id, sessionId }: what services receive for audit fields and session handling
```

The step that depends on the client is the first one only. Everything after it, including roles, permissions,
audit columns and deactivation, works the same for every client.

## Versioning

- Every route is under `API_PREFIX` = `/api/v1` (`platform/http/api-version.ts`).
- The web frontend deploys together with the server, so it always uses the latest version. Mobile apps can't be
  updated together with the server, so old app versions must keep working.
- **Additive changes stay in v1:** a new field in a response, a new optional request field, a new route.
- **Breaking changes need a new version:** a removed or renamed field, a field that changes meaning, a newly required
  input. Add the new route next to the old one, call the same service from both, and keep v1 until no supported app
  version uses it.

## Extending

These features are planned but deliberately not built yet. Each section lists what to add and where. The existing
code is already shaped for it, so none of these require restructuring.

### Mobile API

1. **Sign-in:** in `auth.plugin.ts` → `readCredential()`, also accept `Authorization: Bearer <session id>` and add
   `"bearer"` to `Credential["via"]`. For mobile, `POST /api/v1/auth/login` should return the session id in the body
   instead of setting a cookie, for example when a `client: "mobile"` field is sent. The token is the same
   session as the web uses, so deactivating a user or changing their password logs them out on their phone too.
2. **CORS:** native apps don't send an `Origin` header, so CORS doesn't apply to them, and nothing changes there.
3. **Same routes:** mobile calls the same `/api/v1/...` routes. Add a mobile-specific route only when the app needs a
   different shape, and put it next to the existing one so it calls the same service.
4. **Push notifications:** `integrations/push/` (FCM/APNs), sent from a background job.

### Background jobs

1. `platform/jobs/`: a queue on the existing Redis, for example with BullMQ, plus a small `defineJob(name, handler)`.
2. `src/worker.ts`: a second entry point that registers every `modules/<name>/<name>.jobs.ts` and processes
   the queue. It's the same code and image as the server, run as a separate process, so it scales on its own.
3. Use it for anything slow, scheduled, or calling an outside system that can fail or limit request rates. Jobs call
   module services, like routes do.

### Social media (Facebook, Instagram, LinkedIn, …)

```
src/integrations/
├─ social-provider.ts        interface: connect(), publish(), fetchInsights(), verifyWebhook()
├─ meta/                     client · oauth · webhook signature check (Facebook + Instagram)
└─ linkedin/
src/modules/social/
├─ social.service.ts         "publish this post", "list the inbox": doesn't know which provider
├─ social.routes.ts          /api/v1/social/...
├─ social.webhooks.ts        /webhooks/<provider>: check the signature, queue a job, answer 200 at once
└─ social.jobs.ts            publish-scheduled-post, sync-insights, with retries and backoff
```

- Modules depend on the `SocialProvider` interface, never on one provider. Adding a provider means adding a folder
  in `integrations/`.
- Connected accounts and their OAuth tokens go in a `SocialAccount` table, with tokens encrypted at rest.
- Webhooks are `public` routes outside `/api/v1`, because providers don't send sessions. They're authenticated by
  their signature instead.

### Events between modules

When one module has to react to another, for example "a product went out of stock, so pause its scheduled posts",
add `platform/events/`: a typed in-process event bus. Don't make the modules import each other. If the reaction must
survive a crash, the event should start a job.

## When to split into separate services

Only when one part needs to scale differently or is owned by a different team. The first candidate is the worker,
which this layout already runs as its own process from the same code. The layers and rules above keep any later
split mechanical: a module only talks to the platform and to other modules' services.
