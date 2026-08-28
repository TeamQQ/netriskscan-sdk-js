import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // The SDK is silent by default: nothing here may print a user's request or credentials.
      "no-console": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Examples are runnable scripts; printing is the point.
    files: ["examples/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // This config file is not part of any tsconfig, so type-aware rules cannot run on it.
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
  prettier,
);
