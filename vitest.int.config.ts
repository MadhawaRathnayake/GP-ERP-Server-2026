import { defineConfig } from "vitest/config"

// Integration tests: boot the real app against Postgres + Redis from .env (run `npm run db:migrate` first).
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts", "test/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    env: { LOG_LEVEL: "silent" },
  },
})
