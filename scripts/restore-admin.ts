// `npm run admin:restore -- <email>`
// Recovery for when nobody can open the admin screen: gives the user the system role (Super Admin) and reactivates
// them. It needs database access on the server; there is deliberately no API for it. The change reaches a running
// server through the cache triggers, so the user can sign in straight away.
import { db } from "#core/db.js"

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error("Usage: npm run admin:restore -- <email>")
  process.exit(1)
}

const role = await db.role.findFirst({ where: { isSystem: true }, orderBy: { createdAt: "asc" } })
const user = await db.user.findUnique({ where: { email } })
if (!role) console.error("There is no system role. Run `npm run db:seed` to create Super Admin.")
else if (!user) console.error(`There is no user with the email ${email}.`)
else {
  // modifiedBy stays NULL: the change was made by the system, not a signed-in user.
  await db.user.update({ where: { id: user.id }, data: { roleId: role.id, isDeleted: false, modifiedBy: null, modifiedAt: new Date() } })
  console.log(`${user.id} (${email}) now has the ${role.name} role and is active.`)
}

await db.$disconnect()
process.exitCode = role && user ? 0 : 1
