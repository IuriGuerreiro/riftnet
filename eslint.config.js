import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactDom from "eslint-plugin-react-dom";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import reactX from "eslint-plugin-react-x";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

import comments from "./tools/lint/eslint-comments.js";

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/node_modules",
      "client/src/gen",
      "client/src-tauri",
      "target",
      "spikes",
    ],
  },

  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      parserOptions: {
        project: [
          "./client/tsconfig.app.json",
          "./client/tsconfig.node.json",
          "./tools/mock/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "simple-import-sort": simpleImportSort, unicorn },
    rules: {
      eqeqeq: ["error", "always"],
      curly: ["error", "multi-line"],
      "prefer-const": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],

      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-empty-function": ["error", { allow: ["arrowFunctions"] }],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],

      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",

      "unicorn/prefer-node-protocol": "error",
      "unicorn/no-for-each": "error",
      "unicorn/prefer-at": "error",
      "unicorn/throw-new-error": "error",
      "unicorn/error-message": "error",
      "unicorn/prefer-string-replace-all": "error",
      "unicorn/prefer-array-some": "error",
      "unicorn/prefer-array-find": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-instanceof-array": "error",
      "unicorn/prefer-number-properties": "error",
      "unicorn/no-lonely-if": "error",
      "unicorn/no-useless-undefined": "error",
      "unicorn/prefer-structured-clone": "error",
    },
  },

  {
    files: ["client/**/*.{ts,tsx}"],
    extends: [reactX.configs["recommended-type-checked"], reactDom.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  {
    files: ["client/src/**/*.{ts,tsx}"],
    ignores: ["client/src/api/**", "client/src/stores/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/gen/**"],
              allowTypeImports: true,
              message: "Only api/ and stores/ may use generated protobuf code at runtime.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["tools/mock/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    plugins: { comments },
    rules: { "comments/only-tagged": "error" },
  },

  prettier,
);
