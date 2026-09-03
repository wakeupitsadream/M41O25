import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/sw.js",
      "public/swe-worker*.js",
    ],
  },
  {
    // useRouter из next/navigation только внутри сторожа навигации; остальным — useGuardedRouter (см. CLAUDE.md, P0).
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["components/features/nav-guard.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/navigation",
              importNames: ["useRouter"],
              message: "Используй useGuardedRouter из @/components/features/nav-guard: обход зависания навигации (docs/ROADMAP.md, P0).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
