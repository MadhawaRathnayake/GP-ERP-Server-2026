import "dotenv/config"
import { defineConfig, env } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=development prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
})
