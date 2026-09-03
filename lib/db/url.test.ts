import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDatabaseUrl } from "./url";

test("normalizeDatabaseUrl: sslmode=require → verify-full, остальное не трогаем", () => {
  assert.equal(normalizeDatabaseUrl("postgres://u:p@h/db?sslmode=require&channel_binding=require"), "postgres://u:p@h/db?sslmode=verify-full&channel_binding=require");
  assert.equal(normalizeDatabaseUrl("postgres://u:p@h/db?sslmode=verify-full"), "postgres://u:p@h/db?sslmode=verify-full");
  assert.equal(normalizeDatabaseUrl("postgres://u:p@h/db"), "postgres://u:p@h/db");
  assert.equal(normalizeDatabaseUrl("postgres://u:p@h/db?uselibpqcompat=true&sslmode=require"), "postgres://u:p@h/db?uselibpqcompat=true&sslmode=require");
});
