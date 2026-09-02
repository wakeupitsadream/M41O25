import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/raspison",
  },
  strict: true,
  verbose: true,
});
