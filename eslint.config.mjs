import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/sw.js",
      "public/swe-worker*.js",
      ".claude/**",
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
