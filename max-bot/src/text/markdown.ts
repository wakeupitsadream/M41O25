/**
 * Markdown модели → HTML для MAX (format: "html"). Берём HTML, а не markdown MAX: в математике полно «*», «_», «==»,
 * «#», и разметка MAX съела бы их как форматирование. Здесь форматируется только то, что явно задумано, остальное
 * экранируется. Теги — только те, что есть в официальном SDK: b, i, u, s, code, pre, a.
 */

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

const NBSP = " ";
const CODE_MARK = "\u0002";
const LINK_MARK = "\u0003";

function emphasis(s: string, withItalic = true): string {
  let out = s
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<b>$1</b>")
    .replace(/(?<![\p{L}\p{N}_])__(?=\S)([^\n]*?\S)__(?![\p{L}\p{N}_])/gu, "<b>$1</b>")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "<s>$1</s>");
  if (withItalic) {
    out = out
      .replace(/(?<![\p{L}\p{N}*\\])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\p{L}\p{N}*])/gu, (m, inner: string) =>
        /\p{L}/u.test(inner) ? `<i>${inner}</i>` : m,
      )
      .replace(/(?<![\p{L}\p{N}_\\])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu, (m, inner: string) =>
        /\p{L}/u.test(inner) ? `<i>${inner}</i>` : m,
      );
  }
  return out;
}

/** Теги вложены правильно — иначе MAX отвергнет сообщение целиком. */
export function balancedTags(html: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)(b|i|u|s|code|pre|a)(?:\s[^>]*)?>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, close, tag] = m;
    if (!close) stack.push(tag!);
    else if (stack.pop() !== tag) return false;
  }
  return stack.length === 0;
}

export function inlineToHtml(text: string): string {
  const codes: string[] = [];
  const links: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
    links.push(`<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`);
    return `${LINK_MARK}${links.length - 1}${LINK_MARK}`;
  });
  s = escapeHtml(s);
  let formatted = emphasis(s);
  if (!balancedTags(formatted)) formatted = emphasis(s, false);
  if (!balancedTags(formatted)) formatted = s;
  return formatted
    .replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, "g"), (_m, n: string) => codes[Number(n)] ?? "")
    .replace(new RegExp(`${LINK_MARK}(\\d+)${LINK_MARK}`, "g"), (_m, n: string) => links[Number(n)] ?? "");
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const isTableSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function renderTable(lines: string[]): string[] {
  const rows = lines.map(splitRow);
  const out: string[] = [];
  const hasHeader = rows.length > 1 && isTableSeparator(rows[1]!);
  rows.forEach((cells, idx) => {
    if (isTableSeparator(cells)) return;
    const line = cells.map((c) => inlineToHtml(c)).join(" | ");
    out.push(hasHeader && idx === 0 ? `<b>${line}</b>` : line);
  });
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim().startsWith(marker)) body.push(lines[j++]!);
      out.push(`<pre>${escapeHtml(body.join("\n"))}</pre>`);
      i = j;
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_ROW.test(lines[i + 1] ?? "")) {
      const table: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) table.push(lines[i++]!);
      i--;
      out.push(...renderTable(table));
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push(`<b>${inlineToHtml(heading[1]!.replace(/^\*\*(.*)\*\*$/, "$1"))}</b>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("———");
      continue;
    }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      out.push(`│ ${inlineToHtml(quote[1]!)}`);
      continue;
    }
    const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      const indent = NBSP.repeat(Math.floor(task[1]!.length / 2) * 2);
      out.push(`${indent}${task[2] === " " ? "☐" : "☑"} ${inlineToHtml(task[3]!)}`);
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const indent = NBSP.repeat(Math.floor(bullet[1]!.length / 2) * 2);
      out.push(`${indent}• ${inlineToHtml(bullet[2]!)}`);
      continue;
    }
    const ordered = /^(\s*)(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      const indent = NBSP.repeat(Math.floor(ordered[1]!.length / 2) * 2);
      out.push(`${indent}${ordered[2]}. ${inlineToHtml(ordered[3]!)}`);
      continue;
    }
    out.push(inlineToHtml(line));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Запасной вариант, если MAX не принял HTML: голый текст без тегов. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_m, url: string, label: string) => (label === url ? label : `${label} (${url})`))
    .replace(/<\/?(b|i|u|s|code|pre)>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type Block = { text: string; code: boolean };

function toBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.some((l) => l.trim())) blocks.push({ text: para.join("\n").trim(), code: false });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const body = [line];
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim().startsWith(marker)) body.push(lines[j++]!);
      body.push(lines[j] ?? marker);
      blocks.push({ text: body.join("\n"), code: true });
      i = j;
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

function hardSplit(text: string, fits: (s: string) => boolean): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest && !fits(rest)) {
    // Двоичный поиск самой длинной подходящей головы, затем откат к пробелу или концу предложения.
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(rest.slice(0, mid))) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const head = rest.slice(0, cut);
    const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    const space = head.lastIndexOf(" ");
    if (sentence > cut * 0.5) cut = sentence + 1;
    else if (space > cut * 0.5) cut = space;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function splitBlock(block: Block, fits: (md: string) => boolean): string[] {
  if (block.code) {
    const lines = block.text.split("\n");
    const open = lines[0]!;
    const close = lines[lines.length - 1]!;
    const body = lines.slice(1, -1);
    const pieces: string[] = [];
    let cur: string[] = [];
    const wrapCode = (l: string[]) => [open, ...l, close].join("\n");
    for (const l of body) {
      if (fits(wrapCode([...cur, l]))) cur.push(l);
      else {
        if (cur.length) pieces.push(wrapCode(cur));
        cur = fits(wrapCode([l])) ? [l] : [];
        if (!cur.length) for (const part of hardSplit(l, (s) => fits(wrapCode([s])))) pieces.push(wrapCode([part]));
      }
    }
    if (cur.length) pieces.push(wrapCode(cur));
    return pieces;
  }
  const pieces: string[] = [];
  let cur = "";
  for (const line of block.text.split("\n")) {
    const candidate = cur ? `${cur}\n${line}` : line;
    if (fits(candidate)) {
      cur = candidate;
      continue;
    }
    if (cur) pieces.push(cur);
    if (fits(line)) cur = line;
    else {
      const parts = hardSplit(line, fits);
      cur = parts.pop() ?? "";
      pieces.push(...parts);
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/**
 * Делит ответ на сообщения MAX. Лимит текста — 4000 символов; берём запас на теги и эмодзи.
 * Режем по абзацам, код — по строкам с повтором ограды, длинные строки — по предложениям.
 */
export function splitToHtmlMessages(md: string, limit = 3800): string[] {
  const fits = (s: string) => markdownToHtml(s).length <= limit;
  const chunks: string[] = [];
  let cur = "";
  for (const block of toBlocks(md)) {
    const candidate = cur ? `${cur}\n\n${block.text}` : block.text;
    if (fits(candidate)) {
      cur = candidate;
      continue;
    }
    if (cur) chunks.push(cur);
    cur = "";
    if (fits(block.text)) cur = block.text;
    else {
      const parts = splitBlock(block, fits);
      cur = parts.pop() ?? "";
      chunks.push(...parts);
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map(markdownToHtml).filter((c) => c.trim().length > 0);
}
