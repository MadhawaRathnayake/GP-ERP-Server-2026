import { randomUUID } from "node:crypto"
import { buildApp, type App } from "#app.js"
import { db } from "#core/db.js"
import { hashPassword } from "#security/password.js"
import type { PermissionKey } from "#security/permissions.js"
import { toGrantRows } from "#security/permission-table.js"
import { reserveUserId } from "#modules/users/users.service.js"
import { dbEvents } from "#cache/db-events.plugin.js"

// Shared setup for integration tests (*.int.test.ts): real app, real Postgres + Redis from .env.

export const TEST_PREFIX = "test-"
export const TEST_PASSWORD = "test-password"

export interface TestUser {
  id: string
  email: string
  roleId: string
  /** Value for the `cookie` request header */
  cookie: string
}

export async function startApp(): Promise<App> {
  const app = await buildApp()
  await app.ready()
  return app
}

/** Creates a role for tests (cleaned up by cleanupTestUsers). */
export async function createTestRole(permissions: PermissionKey[]) {
  return db.role.create({
    data: { name: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`, permissions: { create: await toGrantRows(permissions) } },
  })
}

/**
 * Creates an active user (their own creator) and signs them in. Pass permissions to give them a new role with exactly
 * those, or `{ roleId }` to give them an existing role.
 */
export async function signIn(app: App, access: PermissionKey[] | { roleId: string }): Promise<TestUser> {
  const roleId = Array.isArray(access) ? (await createTestRole(access)).id : access.roleId
  const id = await reserveUserId()
  const email = `${TEST_PREFIX}${randomUUID().slice(0, 8)}@test.local`
  await db.user.create({
    data: {
      id,
      createdBy: id,
      name: "Test user",
      email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId,
    },
  })
  return { id, email, roleId, cookie: await login(app, email, TEST_PASSWORD) }
}

/** Signs in and returns the cookie header value; throws if the login fails. */
export async function login(app: App, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`test sign-in failed: ${res.body}`)
  const cookie = res.cookies[0]!
  return `${cookie.name}=${cookie.value}`
}

/** Removes users and roles created by tests: users first (one statement, so users who created each other go together). */
export async function cleanupTestUsers() {
  await db.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } })
  await db.role.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
}

/** Resolves once db-events has invalidated the cache for `table` (writes reach the cache via Postgres NOTIFY). */
export function waitForChange(table: string): Promise<void> {
  return new Promise((resolve) => {
    const onChange = (changed: string) => {
      if (changed !== table) return
      dbEvents.off("change", onChange)
      resolve()
    }
    dbEvents.on("change", onChange)
  })
}
