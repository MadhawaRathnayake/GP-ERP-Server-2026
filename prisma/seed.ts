// `npm run db:seed` — safe to re-run: existing rows are left as they are.
// Creates only what's needed to sign in: the Super Admin role (every permission) and the first admin user.
// Everything else (more roles, users, products, …) is created through the app.
import { db } from "#core/db.js"
import { hashPassword } from "#security/password.js"
import { PERMISSION_DEFINITIONS } from "#security/permissions.js"
import { syncPermissions, toGrantRows } from "#security/permission-table.js"
import { reserveUserId } from "#modules/users/users.service.js"

const SUPER_ADMIN_ROLE = "Super Admin"

// PLACEHOLDER: first admin login. Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env; change the password after first sign-in.
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
const adminPassword = process.env.SEED_ADMIN_PASSWORD
if (!adminEmail || !adminPassword) {
  console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env before seeding.")
  process.exit(1)
}

// The role's grants point at Permission rows, which the server also syncs at boot.
await syncPermissions()
const role = await db.role.upsert({
  where: { name: SUPER_ADMIN_ROLE },
  update: {},
  create: {
    name: SUPER_ADMIN_ROLE,
    description: "Full access to every module and setting.",
    permissions: { create: await toGrantRows(PERMISSION_DEFINITIONS.map((p) => p.key)) },
  },
})

// The first user has nobody to be created by, so they are their own creator.
if (!(await db.user.findUnique({ where: { email: adminEmail } }))) {
  const id = await reserveUserId()
  await db.user.create({
    data: { id, createdBy: id, name: "Administrator", email: adminEmail, passwordHash: await hashPassword(adminPassword), roleId: role.id },
  })
}

console.log(`Seeded the ${SUPER_ADMIN_ROLE} role and admin ${adminEmail}`)
await db.$disconnect()
