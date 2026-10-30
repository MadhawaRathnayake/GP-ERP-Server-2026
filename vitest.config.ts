import { defineConfig } from "vitest/config"

// Unit tests: no Postgres/Redis needed (connections are lazy and never opened).
// Integration tests (*.int.test.ts) run via `npm run test:int`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "node_modules"],
    env: {
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://unit-tests@localhost:5432/unused",
      REDIS_URL: "redis://localhost:6379",
      R2_ACCOUNT_ID: "unit-tests",
      R2_ACCESS_KEY_ID: "unit-tests",
      R2_SECRET_ACCESS_KEY: "unit-tests",
      R2_BUCKET: "unit-tests",
      R2_PUBLIC_URL: "https://images.unit-tests.local",
    },
  },
})
