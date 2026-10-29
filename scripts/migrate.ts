// `npm run db:migrate [-- --name <migration_name>]`
// Wraps `prisma migrate dev` so every table gets the notify_change trigger that keeps the cache in sync:
//   1. prisma migrate dev --create-only   (writes the SQL for schema.prisma changes, doesn't apply it)
//   2. appends trigger SQL for every model table that no migration has a trigger for yet
//   3. prisma migrate dev                 (applies) + prisma generate
// The trigger SQL lands in a normal migration file, so it's reviewed and deployed like any other migration.
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const migrationsDir = path.join(root, "prisma/migrations")
const args = process.argv.slice(2)

const prisma = (...cmd: string[]) => execFileSync("npx", ["prisma", ...cmd], { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
const migrationDirs = () =>
  existsSync(migrationsDir) ? readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []

// Table name of every model in schema.prisma (the model name, or its @@map).
function modelTables(): string[] {
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")
  return [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(([, name, body]) => body?.match(/@@map\("([^"]+)"\)/)?.[1] ?? name!)
}

const before = new Set(migrationDirs())
prisma("migrate", "dev", "--create-only", ...args)
const created = migrationDirs().filter((d) => !before.has(d))

const allSql = migrationDirs()
  .map((d) => path.join(migrationsDir, d, "migration.sql"))
  .filter(existsSync)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")
const missing = modelTables().filter((table) => !allSql.includes(`"${table}_notify_change"`))

if (missing.length > 0) {
  const sql = missing
    .map(
      (t) =>
        `\n-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "${t}" (added by scripts/migrate.ts)\n` +
        `CREATE TRIGGER "${t}_notify_change"\nAFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "${t}"\nFOR EACH STATEMENT EXECUTE FUNCTION notify_change();\n`,
    )
    .join("")

  const target = created.at(-1)
  if (target) {
    appendFileSync(path.join(migrationsDir, target, "migration.sql"), sql)
    console.log(`✔ added notify_change trigger for ${missing.join(", ")} to ${target}`)
  } else {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
    const dir = path.join(migrationsDir, `${stamp}_notify_change`)
    mkdirSync(dir)
    writeFileSync(path.join(dir, "migration.sql"), sql.trimStart())
    console.log(`✔ created ${stamp}_notify_change with triggers for ${missing.join(", ")}`)
  }
} else {
  // `--create-only` writes an empty migration when nothing changed; don't leave it behind.
  for (const dir of created) {
    const file = path.join(migrationsDir, dir, "migration.sql")
    const hasSql = readFileSync(file, "utf8").split("\n").some((line) => line.trim() && !line.trim().startsWith("--"))
    if (!hasSql) rmSync(path.join(migrationsDir, dir), { recursive: true })
  }
}

prisma("migrate", "dev", ...args)
prisma("generate")
