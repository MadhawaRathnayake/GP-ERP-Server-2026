import { db } from "#core/db.js"
import { UnauthorizedError } from "#http/errors.js"
import { hashPassword, verifyPassword } from "#security/password.js"
import { sessions } from "#security/sessions.js"
import { getCurrentUser, type CurrentUser } from "#security/current-user.js"
import type { LoginBody } from "./auth.schema.js"

// Checked when the email doesn't exist, so the response time doesn't reveal which emails have accounts.
const dummyHash = hashPassword("not-a-real-password")

export async function login({ email, password }: LoginBody): Promise<{ sessionId: string; user: CurrentUser }> {
  const user = await db.user.findUnique({ where: { email }, omit: { passwordHash: false } })
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash))
  const current = user && valid ? await getCurrentUser(user.id) : null
  if (!current) throw new UnauthorizedError("Invalid email or password")

  return { sessionId: await sessions.create(current.id), user: current }
}

export function logout(sessionId: string): Promise<void> {
  return sessions.destroy(sessionId)
}
