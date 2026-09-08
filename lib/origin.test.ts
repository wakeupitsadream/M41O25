import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalOrigin, hrefOnOrigin, originStatus } from "./origin";

test("canonicalOrigin: слэш, регистр и порт по умолчанию не меняют адрес", () => {
  assert.equal(canonicalOrigin("https://raspison.vercel.app"), "https://raspison.vercel.app");
  assert.equal(canonicalOrigin("https://raspison.vercel.app/"), "https://raspison.vercel.app");
  assert.equal(canonicalOrigin("https://RASPISON.Vercel.App/s?day=1"), "https://raspison.vercel.app");
  assert.equal(canonicalOrigin("https://raspison.vercel.app:443"), "https://raspison.vercel.app");
  assert.equal(canonicalOrigin("http://localhost:80"), "http://localhost");
  assert.equal(canonicalOrigin("raspison.vercel.app"), "https://raspison.vercel.app");
});

test("canonicalOrigin: нестандартный порт остаётся, мусор и не-http → null", () => {
  assert.equal(canonicalOrigin("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(canonicalOrigin(""), null);
  assert.equal(canonicalOrigin("   "), null);
  assert.equal(canonicalOrigin(null), null);
  assert.equal(canonicalOrigin(undefined), null);
  assert.equal(canonicalOrigin("file:///Users/max/index.html"), null);
  assert.equal(canonicalOrigin("https://"), null);
});

test("originStatus: пустая переменная выключает проверку", () => {
  assert.deepEqual(originStatus("", "https://raspison-git-branch-team.vercel.app"), { kind: "off" });
  assert.deepEqual(originStatus(undefined, "https://raspison-git-branch-team.vercel.app"), { kind: "off" });
  // Текущий адрес не разобрался — молчим, а не пугаем зря.
  assert.deepEqual(originStatus("https://raspison.vercel.app", "about:blank"), { kind: "off" });
});

test("originStatus: свой адрес в любом написании — свой", () => {
  assert.deepEqual(originStatus("https://raspison.vercel.app/", "https://raspison.vercel.app"), { kind: "same" });
  assert.deepEqual(originStatus("https://raspison.vercel.app", "https://RASPISON.vercel.app:443"), { kind: "same" });
  assert.deepEqual(originStatus("http://localhost:3000", "http://localhost:3000"), { kind: "same" });
});

test("originStatus: preview и другая схема — чужой адрес, с хостом для текста плашки", () => {
  assert.deepEqual(originStatus("https://raspison.vercel.app", "https://raspison-git-fix-max.vercel.app"), {
    kind: "foreign",
    expected: "https://raspison.vercel.app",
    host: "raspison.vercel.app",
  });
  assert.deepEqual(originStatus("https://raspison.vercel.app", "http://raspison.vercel.app"), {
    kind: "foreign",
    expected: "https://raspison.vercel.app",
    host: "raspison.vercel.app",
  });
  assert.equal(originStatus("https://raspison.vercel.app", "http://localhost:3001").kind, "foreign");
});

test("hrefOnOrigin: тот же путь на рабочем адресе, без ухода на чужой домен", () => {
  assert.equal(hrefOnOrigin("https://raspison.vercel.app", "/enter?code=M41-AAAA"), "https://raspison.vercel.app/enter?code=M41-AAAA");
  assert.equal(hrefOnOrigin("https://raspison.vercel.app/", "/s/2026-09-08"), "https://raspison.vercel.app/s/2026-09-08");
  assert.equal(hrefOnOrigin("https://raspison.vercel.app", ""), "https://raspison.vercel.app/");
  assert.equal(hrefOnOrigin("https://raspison.vercel.app", "//evil.example/s"), "https://raspison.vercel.app/evil.example/s");
  assert.equal(hrefOnOrigin("https://raspison.vercel.app", "\\\\evil.example/s"), "https://raspison.vercel.app/evil.example/s");
});
