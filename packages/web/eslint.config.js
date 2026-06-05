// Flat ESLint config (ESLint 9) for the web package.
// Added in Phase 0 of the OOP refactor. Intentionally lenient: legacy code is
// cleaned per-file as it's refactored ("lint on touch"), so noisy stylistic
// rules are warnings, not errors, and `any` is allowed for now.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "**/*.config.{js,ts}"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React hook correctness is the rule we DO care about — keep it an error.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Tolerated during the migration; tightened as the service layer lands.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "warn",
      "no-useless-escape": "warn",
    },
  },
);
