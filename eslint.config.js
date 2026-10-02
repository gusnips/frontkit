import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// An em dash gives away AI-written text, so none may reach a reader. Checks every string,
// template piece and JSX text in the library source (error messages, default copy). Comments
// are not nodes, so they stay free. Tests and the check scripts are not linted by this block.
// The regex uses a unicode escape so this file does not contain the character itself.
// READMEs and package.json are covered by scripts/check-no-em-dash.ts.
const NO_EM_DASH = [
  "Literal[value=/\\u2014/]",
  "TemplateElement[value.raw=/\\u2014/]",
  "JSXText[value=/\\u2014/]",
].map((selector) => ({
  selector,
  message: "No em dash in user-facing text. Use a period, comma, colon or parentheses.",
}));

// One config for the whole repo — eslint walks up from each workspace, so
// `eslint src` inside any of the four packages resolves to this file.
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The house rule: no `as any`, no `as unknown as T`. Fix the type.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...NO_EM_DASH] },
  },
  {
    // react/ only. exhaustive-deps is the rule that catches real React bugs.
    files: ["react/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
);
