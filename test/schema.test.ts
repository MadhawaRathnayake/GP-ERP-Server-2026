import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// Every table ends with the audit columns, in this order (AGENTS.md → "How things are done here"). Session is the exception.
const AUDIT_COLUMNS = ["createdBy", "createdAt", "modifiedBy", "modifiedAt", "isActive"]
const EXEMPT = ["Session"]

const schema = readFileSync(path.join(import.meta.dirname, "../prisma/schema.prisma"), "utf8")
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({ name: name!, body: body! }))
const modelNames = new Set(models.map((m) => m.name))

/** Field names that are real columns, in declaration order (relation fields like `creator User?` aren't columns). */
const columns = (body: string) =>
  [...body.matchAll(/^\s+(\w+)\s+(\w+)/gm)].filter(([, , type]) => !modelNames.has(type!)).map(([, name]) => name!)

describe("prisma schema", () => {
  it.each(models.filter((m) => !EXEMPT.includes(m.name)).map((m) => [m.name, m.body]))("%s ends with the audit columns", (_, body) => {
    expect(columns(body).slice(-AUDIT_COLUMNS.length)).toEqual(AUDIT_COLUMNS)
  })
})
