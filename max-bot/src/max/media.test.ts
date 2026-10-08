import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeImageName, sniffAudio, sniffImage } from "./media.js";

const b = (...parts: (number[] | string)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

test("sniffImage", () => {
  assert.equal(sniffImage(b([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(b([0x89], "PNG\r\n")), "image/png");
  assert.equal(sniffImage(b("RIFF", [0, 0, 0, 0], "WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(b([0, 0, 0, 24], "ftypheic")), "image/heic");
  assert.equal(sniffImage(b([0, 0, 0, 24], "ftypmif1")), "image/heif");
  assert.equal(sniffImage(b("hello")), null);
});

test("sniffAudio", () => {
  assert.equal(sniffAudio(b("OggS", [0, 2])), "audio/ogg");
  assert.equal(sniffAudio(b("ID3", [4, 0])), "audio/mpeg");
  assert.equal(sniffAudio(b([0xff, 0xfb, 0x90])), "audio/mpeg");
  assert.equal(sniffAudio(b([0xff, 0xf1, 0x50])), "audio/aac");
  assert.equal(sniffAudio(b([0, 0, 0, 32], "ftypM4A ")), "audio/mp4");
  assert.equal(sniffAudio(b("RIFF", [0, 0, 0, 0], "WAVEfmt ")), "audio/wav");
  assert.equal(sniffAudio(b([0x1a, 0x45, 0xdf, 0xa3])), "audio/webm");
  assert.equal(sniffAudio(b("#!AMR\n")), "audio/amr");
  assert.equal(sniffAudio(b("text")), null);
});

test("looksLikeImageName", () => {
  assert.equal(looksLikeImageName("IMG_0001.HEIC"), true);
  assert.equal(looksLikeImageName("scan.pdf"), false);
  assert.equal(looksLikeImageName(undefined), false);
});
