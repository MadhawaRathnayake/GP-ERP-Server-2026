# GP ERP Server — Agent Guide

Backend for the GP ERP web app (frontend: sibling folder `../GP-ERP`). Read this file before changing anything. Deeper
docs: `README.md` (how to add an API, permissions, caching, errors) and `ARCHITECTURE.md` (layers, rules, extending).
Read the relevant section there instead of guessing.

## Rules for AI agents (mandatory)

1. **Git is read-only.** Allowed: commands that only read: `git status`, `git log`, `git diff`, `git show`,
   `git blame`, `git shortlog`, `git ls-files`, `git rev-parse`, `git branch` (listing only). Prohibited: anything that
   changes the repository, its history, the index or remotes: `commit`, `push`, `pull`, `fetch`, `merge`, `rebase`,
   `reset`, `checkout`, `switch`, `restore`, `stash`, `add`, `rm`, `mv`, `tag`, `branch -d/-m`, `cherry-pick`,
   `revert`, `clean`, `remote add/remove`, `config` (writing), `init`, `clone`, `gh pr create`, … This applies even if
   a task seems to need it. Leave changes uncommitted; the user commits. (Enforced for Claude Code by
   `.claude/hooks/git-read-only.mjs`.)
2. **Code quality first. Do only the necessary changes.** Match the surrounding code's style, naming and comment
   density. No drive-by refactors, renames or reformatting.
3. **Ask before broad changes:** a new dependency, a new top-level folder, a change to `platform/`, or a change across
   many modules. Explain the plan first.
4. **The database is shared and real (`ERP-DB`).** Never reset, drop or `prisma db push`. Never run `npm run db:seed`,
   insert data, or run `npm run test:int` without asking (the integration tests use `ERP-DB` and use up user ids).
5. **Secrets:** don't read or print `.env`; use `.env.example` for variable names. Mask passwords in any URL you show.
6. **Frontend (`../GP-ERP`):** it has its own `AGENTS.md`. Don't edit it unless asked; tell the user which change the
   frontend needs.
7. **Verify before reporting done:** `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` must pass.
   Say what you checked and what you didn't. Update `README.md` / `ARCHITECTURE.md` when behavior or structure changes.

## Stack

Node 24 · TypeScript (strict, ESM) · Fastify 5 · zod 4 (`fastify-type-provider-zod`) · Prisma 7 (`@prisma/adapter-pg`)
· PostgreSQL · Redis (ioredis) · pino · Vitest. Package manager: **npm**.

## Commands

```bash
npm run dev          # http://localhost:3000, docs at /docs, debugger on 9229
npm run typecheck    # tsc
npm run lint         # eslint, which also enforces the layering and import rules
npm test             # unit tests, no DB/Redis needed
npm run build        # clean dist/ + compile
npm run db:migrate -- --name <name>   # new migration from schema.prisma + cache triggers + generate
```

Run TypeScript entry points with `tsx --conditions=development` (needed for the `#` aliases); the npm scripts do.

## Layout (details: ARCHITECTURE.md)

```
src/server.ts · app.ts       entry point · app setup (all modules mounted under /api/v1)
src/config/env.ts            every env var, validated with zod
src/platform/                how the app works: core (db, redis, logger) · cache · http · security
src/modules/<name>/          one folder per feature: <name>.schema.ts · .service.ts · .routes.ts · .int.test.ts
src/generated/               Prisma client (generated, never edit)
prisma/                      schema.prisma · migrations/ · seed.ts
test/                        helpers.ts · app.test.ts (wiring + access matrix)
```

- Dependencies point down: `modules → platform`. `platform/` never imports `modules/`. `platform/core/` imports only
  `#config` and `#generated`.
- Imports: `#core/…`, `#cache/…`, `#http/…`, `#security/…`, `#config/…`, `#modules/…`, `#generated/…`, `#test/…`
  across folders, `./x.js` within a folder. Never `../`. Always write the `.js` extension.
- `*.plugin.ts` = Fastify plugin registered in `app.ts`; everything else is plain functions.

## How things are done here

- **New API:** follow `src/modules/customers/` and README → "Adding an API". Routes are discovered automatically; don't
  edit `app.ts`.
- **Services** take plain arguments plus an `Actor` (`actorOf(req)`) and never touch `request`/`reply`. They return
  Prisma rows; the zod response schema shapes the output.
- **Errors:** throw `AppError` subclasses from `#http/errors.js` (or a feature's `<name>.errors.ts`). Never format error
  responses by hand.
- **Access:** every route under `/api/v1` needs a session by default. `config: { public: true }` or
  `config: { permission: "SCREEN.ACTION" }`. Codes live in `src/platform/security/permissions.ts` (synced to the DB at
  boot). Users get permissions only through their role. Add every new route to the access matrix in `test/app.test.ts`.
- **Caching:** `config: { cache: ["Table", …] }` on GET routes, listing every table the response reads. Invalidation is
  automatic (Postgres triggers). Use `cache.remember()` outside routes.
- **Database changes:** edit `prisma/schema.prisma`, run `npm run db:migrate`. **Never edit an applied migration:**
  Prisma checksums them. Mark hand-written SQL with `-- hand-written:`. Timestamps are `@db.Timestamptz(3)`; money is
  `Decimal @db.Decimal(14, 2)` with `money` from `#http/fields.js`.
- **Every table ends with the audit columns, in this order:** `createdBy`, `createdAt`, `modifiedBy`, `modifiedAt`,
  `isActive`. The only exception is `Session`. Copy them from an existing model (e.g. `Product`): `createdBy`/`modifiedBy`
  link to `User` and are set from the actor (NULL = written by the system); `modifiedAt` is NULL until the first change
  (no `updatedAt`); `isActive = false` is a soft delete. `test/schema.test.ts` fails if a table breaks this.
- **Users:** ids are `USER00001…` from `next_user_id()`. Delete is soft (`isActive = false`). The audit columns
  `createdBy/createdAt/modifiedBy/modifiedAt` are set from the actor and never accepted from clients.

## Known pitfalls

- zod `.partial()` keeps `.default()`s, so building an update schema from a create schema with defaults makes PATCH
  reset fields. Build update schemas from fields without defaults (see `products.schema.ts`).
- `Prisma.<Model>GetPayload` ignores the global `omit` (`passwordHash`): wrap it in `Omit<…, "passwordHash">`.
- Log in to `/docs` via `POST /api/v1/auth/login` before trying protected routes there (cookie auth).
