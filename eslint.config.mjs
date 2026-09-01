import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    "dist/**",
    "node_modules/**",
    "examples/**",
    "tmp/**",
    "public/**",
    ".private/**",
    // The Python OCR service ships JavaScript dependencies inside its virtualenv.
    "ocr-service/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    files: ["**/*.{ts,tsx,mjs,mts}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The extractors match ideographic spaces in official documents, so full-width
      // whitespace is data here rather than a typo.
      "no-irregular-whitespace": "off",
      // Escaping "-" inside character classes is deliberate and keeps them readable.
      "no-useless-escape": "off",
      // Pre-existing dashboard pattern; reported so it stays visible without failing lint.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
