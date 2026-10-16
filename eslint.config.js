import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "client/dist/**", "server/dist/**", "client/src/**/*.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { console: "readonly", process: "readonly", Buffer: "readonly", setTimeout: "readonly", clearInterval: "readonly", setInterval: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { console: "readonly", window: "readonly", document: "readonly", navigator: "readonly", fetch: "readonly", setTimeout: "readonly", clearInterval: "readonly", setInterval: "readonly" },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    files: ["server/src/**/*.{ts,tsx}", "server/scripts/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", Buffer: "readonly" },
    },
  }
);
