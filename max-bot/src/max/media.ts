/** Определение формата по сигнатуре: Content-Type от CDN бывает пустым или application/octet-stream. */

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

export function sniffImage(buf: Buffer): string | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (ascii(buf, 0, 4) === "GIF8") return "image/gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(brand)) return "image/heic";
    if (/^(mif1|msf1|heif)$/.test(brand)) return "image/heif";
    if (/^avi[fs]$/.test(brand)) return "image/avif";
  }
  return null;
}

export function sniffAudio(buf: Buffer): string | null {
  if (ascii(buf, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(buf, 0, 3) === "ID3") return "audio/mpeg";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(buf, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(buf, 0, 5) === "#!AMR") return "audio/amr";
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (ascii(buf, 4, 8) === "ftyp") return "audio/mp4";
  if (buf.length >= 2 && buf[0] === 0xff) {
    const b1 = buf[1] ?? 0;
    if ((b1 & 0xf6) === 0xf0) return "audio/aac"; // ADTS
    if ((b1 & 0xe0) === 0xe0) return "audio/mpeg"; // MPEG audio frame sync
  }
  return null;
}

const AUDIO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/amr": "amr",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
};

export const audioExtension = (mime: string) => AUDIO_EXT[mime] ?? "bin";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;
export const looksLikeImageName = (name: string | undefined) => Boolean(name && IMAGE_EXT.test(name));
