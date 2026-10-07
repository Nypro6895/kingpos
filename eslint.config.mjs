import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["desktop/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  { files: ["tests/**/*.mjs"], rules: { "@next/next/no-assign-module-variable": "off", "react/no-children-prop": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "desktop/dist*/**",
    "desktop/node_modules/**",
    "desktop/build/**",
    "work/**",
    "artifacts/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
