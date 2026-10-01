import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    // Фото пользователей идут через /api/files с images.unoptimized — next/image в проекте не используется нигде,
    // и правило только плодило точечные отключения.
    rules: { "@next/next/no-img-element": "off" },
  },
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
];

export default eslintConfig;
