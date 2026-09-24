import type JSZip from "jszip";
import { SaxParser, type SaxHandler } from "./extract-sax";

/*
 * Чтение частей DOCX/PPTX/XLSX с жёстким потолком РЕАЛЬНО распакованных байт (docs/AI-CHAT.md §5).
 *
 * Размеры из центрального каталога zip пишет сам архив, и им верить нельзя: файл в 4 МБ с заявленными 1000 байт
 * распаковывается в гигабайт, а JSZip сверяет размер только после полной распаковки (compressedObject.js, обработчик
 * end). Поэтому здесь нет ни одного обращения к заявленным размерам: часть распаковывается потоком (JSZip
 * internalStream — куски по 16 КБ сжатых данных, между кусками setImmediate), каждый кусок сразу уходит в потоковый
 * разбор XML, байты считаются по факту. Набрали потолок части, общий потолок документа или вышло время —
 * распаковка ставится на паузу и больше не продолжается. В памяти — кусок и то, что оставил себе обработчик.
 *
 * Без server-only: тесты гоняют чтение на архивах, собранных jszip, и на подделанной zip-бомбе.
 */

/** Почему чтение части оборвали: потолок части, общий потолок документа, дедлайн извлечения. */
export type CutReason = "part" | "total" | "time";

export type PartResult = {
  /** Часть есть в архиве. */
  found: boolean;
  /** Часть прочитана до конца. false и cut = null — обработчик сам сказал «хватит» (набрал бюджет символов). */
  complete: boolean;
  /** Реально распакованных байт этой части. */
  bytes: number;
  cut: CutReason | null;
};

export type ArchiveLimits = {
  /** Потолок распакованных байт одной части. */
  partBytes: number;
  /** Общий потолок распакованных байт на весь документ — все части вместе. */
  totalBytes: number;
  /** Date.now(), после которого части не дочитываются. */
  deadline: number;
};

/**
 * Откуда читатели форматов (extract-docx, extract-xml) берут части: настоящий архив или набор XML-строк в тестах.
 * Один и тот же код разбора работает и там, и там.
 */
export interface PartSource {
  readonly names: readonly string[];
  has(name: string): boolean;
  parse(name: string, handler: SaxHandler, maxBytes?: number): Promise<PartResult>;
  /** Первая причина недочитанного: потолок части, общий потолок документа, время. */
  readonly cut: CutReason | null;
  readonly timedOut: boolean;
}

const MEMORY_CHUNK = 16 * 1024;

/** Части из готовых строк — для тестов на фикстурах: без zip, без потолков и дедлайна. */
export function memorySource(files: Readonly<Record<string, string>>): PartSource {
  const names = Object.keys(files);
  return {
    names,
    cut: null,
    timedOut: false,
    has: (name) => name in files,
    parse: async (name, handler) => {
      if (!(name in files)) return { found: false, complete: true, bytes: 0, cut: null };
      // Кусками, как из распаковки: обработчики должны уметь остановиться посреди длинного текста.
      const p = new SaxParser(handler);
      const xml = files[name];
      for (let i = 0; i < xml.length && !p.stopped; i += MEMORY_CHUNK) p.write(xml.slice(i, i + MEMORY_CHUNK));
      p.end();
      return { found: true, complete: !p.stopped, bytes: files[name].length, cut: p.overflow ? "part" : null };
    },
  };
}

/** Публичный, но не описанный в index.d.ts JSZip 3.x API: ZipObject#internalStream → StreamHelper. */
type StreamHelper = {
  on(evt: "data", fn: (chunk: Uint8Array) => void): StreamHelper;
  on(evt: "end", fn: () => void): StreamHelper;
  on(evt: "error", fn: (e: unknown) => void): StreamHelper;
  pause(): StreamHelper;
  resume(): StreamHelper;
};
type Streamable = { internalStream(type: "uint8array"): StreamHelper };

/**
 * Архив заявил один размер, а распаковалось другое. Раз мы дочитали часть до конца под своим потолком, данные
 * настоящие и безопасные — врёт только заголовок; выбрасывать из-за этого прочитанное незачем.
 */
const SIZE_MISMATCH = /uncompressed data size mismatch/;

/** Кодировка части по BOM: OOXML почти всегда UTF-8, но спецификация разрешает и UTF-16. */
function decoderFor(first: Uint8Array): TextDecoder {
  if (first[0] === 0xff && first[1] === 0xfe) return new TextDecoder("utf-16le");
  if (first[0] === 0xfe && first[1] === 0xff) return new TextDecoder("utf-16be");
  return new TextDecoder("utf-8");
}

export class Archive implements PartSource {
  /** Сколько байт распаковано по всем частям документа. */
  used = 0;
  /** Первая причина, по которой что-то недочитано (для пометки модели); null — всё, что читали, дочитано. */
  cut: CutReason | null = null;
  readonly names: readonly string[];
  private readonly nameSet: ReadonlySet<string>;

  constructor(
    private readonly zip: JSZip,
    private readonly limits: ArchiveLimits,
  ) {
    this.names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    this.nameSet = new Set(this.names);
  }

  has(name: string): boolean {
    return this.nameSet.has(name);
  }

  get timedOut(): boolean {
    return Date.now() >= this.limits.deadline;
  }

  /**
   * Прогнать часть через потоковый разбор XML. Никогда не держит часть целиком: кусок распаковки → декодер →
   * SaxParser → обработчик. maxBytes — потолок этой части (не больше общего partBytes).
   */
  parse(name: string, handler: SaxHandler, maxBytes = this.limits.partBytes): Promise<PartResult> {
    const f = this.zip.file(name);
    if (!f) return Promise.resolve({ found: false, complete: true, bytes: 0, cut: null });
    if (this.timedOut) return Promise.resolve(this.mark({ found: true, complete: false, bytes: 0, cut: "time" }));
    if (this.used >= this.limits.totalBytes) return Promise.resolve(this.mark({ found: true, complete: false, bytes: 0, cut: "total" }));
    const partCap = Math.min(maxBytes, this.limits.partBytes);
    const parser = new SaxParser(handler);
    let decoder: TextDecoder | null = null;
    let bytes = 0;

    return new Promise<PartResult>((resolve, reject) => {
      let settled = false;
      const helper = (f as unknown as Streamable).internalStream("uint8array");
      const finish = (r: Omit<PartResult, "found" | "bytes">) => {
        if (settled) return;
        settled = true;
        // Пауза останавливает DataWorker на следующем куске: остаток бомбы так и не распакуется.
        helper.pause();
        resolve(this.mark({ found: true, bytes, ...r }));
      };
      // Исключение из обработчика внутри события JSZip ушло бы в setImmediate и уронило бы процесс — превращаем
      // его в отказ промиса: extract.ts поймает и скажет модели «не удалось прочитать».
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        helper.pause();
        reject(e);
      };
      const feed = (chunk: Uint8Array) => {
        decoder ??= decoderFor(chunk);
        parser.write(decoder.decode(chunk, { stream: true }));
      };
      const flush = () => {
        if (decoder) parser.write(decoder.decode());
        parser.end();
        finish({ complete: !parser.overflow, cut: parser.overflow ? "part" : null });
      };
      helper
        .on("data", (chunk) => {
          // pako отдаёт выход одного сжатого куска синхронно (до ~16 МБ у бомбы) — после остановки просто не смотрим.
          if (settled) return;
          try {
            if (Date.now() >= this.limits.deadline) return finish({ complete: false, cut: "time" });
            const room = Math.min(partCap - bytes, this.limits.totalBytes - this.used);
            const take = chunk.length <= room ? chunk : chunk.subarray(0, Math.max(0, room));
            bytes += take.length;
            this.used += take.length;
            if (take.length) feed(take);
            if (parser.overflow) return finish({ complete: false, cut: "part" });
            if (parser.stopped) return finish({ complete: false, cut: null });
            if (take.length < chunk.length) return finish({ complete: false, cut: partCap - bytes <= 0 ? "part" : "total" });
          } catch (e) {
            fail(e);
          }
        })
        .on("end", () => {
          if (settled) return;
          try {
            flush();
          } catch (e) {
            fail(e);
          }
        })
        .on("error", (e) => {
          if (settled) return;
          try {
            if (e instanceof Error && SIZE_MISMATCH.test(e.message)) flush();
            else fail(e);
          } catch (err) {
            fail(err);
          }
        })
        .resume();
    });
  }

  private mark(r: PartResult): PartResult {
    if (r.cut) this.cut ??= r.cut;
    return r;
  }
}

/** Самое частое у «битых» DOCX/XLSX: это не zip, а контейнер CFB — файл под паролем или старый .doc с новым расширением. */
export const isCfb = (body: Uint8Array): boolean => body.length >= 4 && body[0] === 0xd0 && body[1] === 0xcf && body[2] === 0x11 && body[3] === 0xe0;

/** Архив отвергнут до распаковки; message — пометка для модели. */
export class ArchiveRejected extends Error {}

/**
 * Больше записей в настоящем документе не бывает (презентация на 300 слайдов с картинками — пара тысяч), а каждая
 * запись — объект JSZip: 4 МБ архива из пустых записей — это ~36 000 записей и ~100 МБ памяти на одном каталоге.
 */
const MAX_ENTRIES = 10_000;
const CENTRAL_SIG = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

/**
 * Записи центрального каталога считаем сами по сигнатурам, до JSZip: число записей в конце архива (EOCD) пишет сам
 * архив, а JSZip читает записи подряд по сигнатурам, сколько бы там ни было заявлено.
 */
function countEntries(body: Uint8Array): number {
  const buf = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  let n = 0;
  for (let i = buf.indexOf(CENTRAL_SIG); i !== -1 && n <= MAX_ENTRIES; i = buf.indexOf(CENTRAL_SIG, i + 4)) n++;
  return n;
}

/**
 * Открыть архив: JSZip читает только центральный каталог и ничего не распаковывает (checkCRC32 выключен —
 * иначе он распаковал бы всё ради контрольных сумм).
 */
export async function openArchive(body: Uint8Array, limits: ArchiveLimits): Promise<Archive> {
  if (countEntries(body) > MAX_ENTRIES) throw new ArchiveRejected("в файле слишком много частей для документа — пришли PDF или фото");
  const JSZipCtor = (await import("jszip")).default;
  const zip = await JSZipCtor.loadAsync(body, { checkCRC32: false });
  return new Archive(zip, limits);
}

/** Путь части из Target в .rels: относительно папки исходной части, «/…» — от корня архива. */
export function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
