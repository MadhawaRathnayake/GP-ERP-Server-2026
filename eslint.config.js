import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist", "src/generated", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-imports": ["error", { patterns: [{ group: ["../*"], message: "Use a #alias for imports outside this folder (see package.json → imports)." }] }],
    },
  },
  // Layering (ARCHITECTURE.md): dependencies point down only — modules → platform → core.
  {
    files: ["src/platform/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["../*"], message: "Use a #alias for imports outside this folder (see package.json → imports)." },
        { regex: "^#(modules/|app\\.js$)", message: "platform/ must not depend on modules/ or the app. Move the shared code into platform/." },
      ] }],
    },
  },
  {
    files: ["src/platform/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["../*"], message: "Use a #alias for imports outside this folder (see package.json → imports)." },
        { regex: "^#(?!config/|generated/)", message: "platform/core/ may import only #config and #generated." },
      ] }],
    },
  },
)
