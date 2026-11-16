/**
 * LaTeX → обычный текст с Unicode. MAX формулы не рендерит, а модели пишут \frac и $…$ даже при прямом запрете,
 * поэтому каждый ответ проходит через convertMath: формулы в $…$, $$…$$, \(…\), \[…\] и окружениях превращаются
 * в «x² + √(a+b) ≤ π/2», голые команды вне разделителей — тоже. Код в `…` и ```…``` не трогаем.
 */

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ",
  n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ",
  P: "ᴾ", R: "ᴿ", T: "ᵀ", U: "ᵁ", V: "ⱽ", W: "ᵂ",
  α: "ᵅ", β: "ᵝ", γ: "ᵞ", δ: "ᵟ", ε: "ᵋ", θ: "ᶿ", ι: "ᶥ", φ: "ᵠ", χ: "ᵡ",
};

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ",
  t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
  β: "ᵦ", γ: "ᵧ", ρ: "ᵨ", φ: "ᵩ", χ: "ᵪ",
};

const SUP_VALUES = new Set(Object.values(SUP));
const SUB_VALUES = new Set(Object.values(SUB));

const SYMBOLS: Record<string, string> = {
  // греческие
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
  pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ",
  Psi: "Ψ", Omega: "Ω",
  // операции и отношения
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "•",
  le: "≤", leq: "≤", leqslant: "≤", ge: "≥", geq: "≥", geqslant: "≥", ne: "≠", neq: "≠", approx: "≈",
  simeq: "≃", cong: "≅", equiv: "≡", sim: "~", propto: "∝", ll: "≪", gg: "≫", lt: "<", gt: ">",
  infty: "∞", to: "→", rightarrow: "→", longrightarrow: "⟶", leftarrow: "←", gets: "←", Rightarrow: "⇒",
  Longrightarrow: "⟹", Leftarrow: "⇐", Leftrightarrow: "⇔", leftrightarrow: "↔", iff: "⇔", implies: "⇒",
  mapsto: "↦", uparrow: "↑", downarrow: "↓", nearrow: "↗", searrow: "↘",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪",
  cap: "∩", setminus: "∖", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄",
  neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  partial: "∂", nabla: "∇", angle: "∠", perp: "⊥", parallel: "∥", mid: "|", triangle: "△", square: "□",
  degree: "°", prime: "′", ldots: "…", dots: "…", dotsc: "…", dotsb: "…", cdots: "⋯", vdots: "⋮",
  ddots: "⋱", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", langle: "⟨", rangle: "⟩",
  lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", vert: "|", Vert: "‖", lvert: "|", rvert: "|",
  lVert: "‖", rVert: "‖", backslash: "\\", colon: ":", therefore: "∴", because: "∵", checkmark: "✓",
  // пробелы
  quad: "  ", qquad: "    ", enspace: " ", thinspace: " ",
  // разделители без размера
  lbrace: "{", rbrace: "}", lbrack: "[", rbrack: "]",
};

/** Однобуквенные экранированные команды: \{ \% \, и т. п. */
const ESCAPES: Record<string, string> = {
  "{": "{", "}": "}", "%": "%", $: "$", "&": "&", "#": "#", _: "_", ",": " ", ":": " ", ";": " ", "!": "",
  " ": " ", "|": "‖", "\\": "\n", "-": "",
};

const FUNCS = new Set([
  "sin", "cos", "tan", "tg", "cot", "ctg", "sec", "csc", "cosec", "arcsin", "arccos", "arctan", "arctg",
  "arcctg", "sinh", "cosh", "tanh", "coth", "sh", "ch", "th", "cth", "log", "lg", "ln", "exp", "det",
  "dim", "ker", "deg", "gcd", "lcm", "arg", "Pr", "hom", "rank", "sgn", "sign", "Var", "Cov", "max",
  "min", "sup", "inf", "lim", "limsup", "liminf",
]);

/** Команды, у которых индексы удобнее показать в скобках: lim(x→∞), ∑(i=1…n). */
const BIG_OPS: Record<string, string> = {
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂",
  lim: "lim", limsup: "lim sup", liminf: "lim inf", max: "max", min: "min", sup: "sup", inf: "inf",
};

const FONT_CMDS = new Set([
  "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathfrak", "mathscr", "boldsymbol", "bm",
  "pmb", "mathnormal", "textnormal", "boxed", "cancel", "bcancel", "xcancel", "sout", "emph",
]);
const TEXT_CMDS = new Set(["text", "textrm", "textbf", "textit", "textsf", "texttt", "textup", "mbox", "hbox"]);
const IGNORED = new Set([
  "left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr",
  "Biggl", "Biggr", "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle", "limits", "nolimits",
  "nonumber", "notag", "rm", "bf", "it", "sf", "tt", "cal", "normalsize", "small", "large", "Large",
  "centering", "hfill", "allowbreak", "mathstrut", "strut",
]);
const ONE_ARG_DROPPED = new Set(["label", "phantom", "hphantom", "vphantom", "color", "hspace", "vspace"]);
const DOUBLE_STRUCK: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", E: "𝔼", "1": "𝟙" };

/** Маркер «здесь нужен пробел, если дальше буква или цифра» после sin, log и т. п. */
const FN_GAP = "\u0001";

type Node =
  | { k: "char"; ch: string }
  | { k: "cmd"; name: string }
  | { k: "group"; nodes: Node[] }
  | { k: "sup" }
  | { k: "sub" }
  | { k: "env"; name: string; inner: string };

/** Позиция конца окружения \begin{name}…\end{name} с учётом вложенности; -1 — не закрыто. */
function findEnvEnd(src: string, from: number, name: string): { innerEnd: number; end: number } {
  const open = `\\begin{${name}}`;
  const close = `\\end{${name}}`;
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const nextOpen = src.indexOf(open, i);
    const nextClose = src.indexOf(close, i);
    if (nextClose < 0) return { innerEnd: -1, end: -1 };
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + open.length;
      continue;
    }
    depth--;
    if (depth === 0) return { innerEnd: nextClose, end: nextClose + close.length };
    i = nextClose + close.length;
  }
  return { innerEnd: -1, end: -1 };
}

/** Разбор в дерево. Возвращает узлы и позицию, на которой остановились (на «}» при inGroup). */
function parse(src: string, start = 0, inGroup = false): { nodes: Node[]; pos: number } {
  const nodes: Node[] = [];
  let i = start;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "}") {
      if (inGroup) return { nodes, pos: i + 1 };
      i++;
      continue;
    }
    if (c === "{") {
      const inner = parse(src, i + 1, true);
      nodes.push({ k: "group", nodes: inner.nodes });
      i = inner.pos;
      continue;
    }
    if (c === "^") {
      nodes.push({ k: "sup" });
      i++;
      continue;
    }
    if (c === "_") {
      nodes.push({ k: "sub" });
      i++;
      continue;
    }
    if (c === "\\") {
      const m = /^[A-Za-z]+/.exec(src.slice(i + 1));
      if (m) {
        const name = m[0];
        let next = i + 1 + name.length;
        if (name === "begin") {
          const env = /^\s*\{([A-Za-z]+\*?)\}/.exec(src.slice(next));
          if (env) {
            const envName = env[1]!;
            const innerStart = next + env[0].length;
            const { innerEnd, end } = findEnvEnd(src, innerStart, envName);
            const stop = innerEnd < 0 ? src.length : innerEnd;
            nodes.push({ k: "env", name: envName, inner: src.slice(innerStart, stop) });
            i = end < 0 ? src.length : end;
            continue;
          }
        }
        if (name === "end") {
          const env = /^\s*\{[A-Za-z]+\*?\}/.exec(src.slice(next));
          i = next + (env ? env[0].length : 0);
          continue;
        }
        nodes.push({ k: "cmd", name });
        i = next;
        continue;
      }
      const ch = src[i + 1];
      if (ch !== undefined) nodes.push({ k: "cmd", name: ch });
      i += 2;
      continue;
    }
    nodes.push({ k: "char", ch: c });
    i++;
  }
  return { nodes, pos: i };
}

const isSpace = (n: Node | undefined) => n?.k === "char" && /\s/.test(n.ch);

function takeArg(nodes: Node[], i: number): { arg: Node[]; next: number } {
  let j = i;
  while (isSpace(nodes[j])) j++;
  const n = nodes[j];
  if (!n) return { arg: [], next: j };
  if (n.k === "group") return { arg: n.nodes, next: j + 1 };
  if (n.k === "sup" || n.k === "sub") return { arg: [], next: j };
  return { arg: [n], next: j + 1 };
}

function takeOptional(nodes: Node[], i: number): { arg: Node[] | null; next: number } {
  const n = nodes[i];
  if (n?.k !== "char" || n.ch !== "[") return { arg: null, next: i };
  const out: Node[] = [];
  for (let j = i + 1; j < nodes.length; j++) {
    const m = nodes[j]!;
    if (m.k === "char" && m.ch === "]") return { arg: out, next: j + 1 };
    out.push(m);
  }
  return { arg: null, next: i };
}

function toScript(raw: string, sup: boolean): string | null {
  const s = raw.replace(/\s+/g, "");
  if (sup && (s === "∘" || s === "\\circ")) return "°";
  if (sup && (s === "′" || s === "'")) return "′";
  const map = sup ? SUP : SUB;
  const done = sup ? SUP_VALUES : SUB_VALUES;
  let out = "";
  for (const ch of s) {
    const mapped = map[ch] ?? (done.has(ch) ? ch : undefined);
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out;
}

function script(raw: string, sup: boolean): string {
  const s = raw.trim();
  if (!s) return "";
  const uni = toScript(s, sup);
  if (uni !== null) return uni;
  const mark = sup ? "^" : "_";
  return [...s].length === 1 ? `${mark}${s}` : `${mark}(${s})`;
}

/** Атом без скобок: буквы/цифры/индексы или выражение, целиком взятое в одни скобки. */
function isSimple(s: string): boolean {
  if (/^[\p{L}\p{N}.,'′°²³¹⁰-₟ᴬ-ᶿⱼⱽ√∞π]+$/u.test(s)) return true;
  if (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
    return true;
  }
  return false;
}

const wrap = (s: string) => (isSimple(s) ? s : `(${s})`);

function combine(s: string, mark: string, eachChar: boolean): string {
  const chars = [...s];
  if (chars.length === 0) return "";
  if (chars.length === 1 || eachChar) return chars.map((c) => (/\s/.test(c) ? c : c + mark)).join("");
  return `(${s})${mark}`;
}

/** Делит содержимое окружения на строки (\\) и ячейки (&) верхнего уровня. */
function splitTable(inner: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth === 0 && c === "\\" && inner[i + 1] === "\\") {
      cells.push(cur);
      rows.push(cells);
      cells = [];
      cur = "";
      i++;
      continue;
    }
    if (depth === 0 && c === "\\" && inner.startsWith("\\cr", i) && !/[A-Za-z]/.test(inner[i + 3] ?? "")) {
      cells.push(cur);
      rows.push(cells);
      cells = [];
      cur = "";
      i += 2;
      continue;
    }
    if (depth === 0 && c === "&" && inner[i - 1] !== "\\") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur);
  rows.push(cells);
  return rows
    .map((r) => r.map((cell) => renderFragment(cell).trim()))
    .filter((r) => r.some((cell) => cell !== ""));
}

const MATRIX_BRACKETS: Record<string, [string, string]> = {
  matrix: ["[", "]"], smallmatrix: ["[", "]"], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"],
  vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], array: ["[", "]"],
};

function renderEnv(name: string, inner: string): string {
  const base = name.replace(/\*$/, "");
  let body = inner;
  if (base === "array" || base === "tabular") body = body.replace(/^\s*\{[^{}]*\}/, "");
  const rows = splitTable(body);
  if (base === "cases" || base === "dcases" || base === "rcases") {
    const clean = (cell: string) => cell.replace(/[,;]\s*$/, "").trim();
    return `{ ${rows.map((r) => r.map(clean).filter(Boolean).join(", ")).join("; ")} }`;
  }
  const brackets = MATRIX_BRACKETS[base];
  if (brackets) return `${brackets[0]}${rows.map((r) => r.join(", ")).join("; ")}${brackets[1]}`;
  return rows.map((r) => r.join(" ").replace(/\s+/g, " ").trim()).join("\n");
}

function renderText(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.k === "char") out += n.ch === "~" ? " " : n.ch;
    else if (n.k === "group") out += renderText(n.nodes);
    else out += renderNodes([n]);
  }
  return convertMath(out);
}

function renderCmd(nodes: Node[], i: number): { text: string; next: number } {
  const n = nodes[i] as { k: "cmd"; name: string };
  const name = n.name;
  const after = i + 1;

  if (name in ESCAPES) return { text: ESCAPES[name]!, next: after };

  if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
    const a = takeArg(nodes, after);
    const b = takeArg(nodes, a.next);
    const num = renderNodes(a.arg).trim();
    const den = renderNodes(b.arg).trim();
    return { text: `${wrap(num)}/${wrap(den)}`, next: b.next };
  }
  if (name === "binom" || name === "dbinom" || name === "tbinom") {
    const a = takeArg(nodes, after);
    const b = takeArg(nodes, a.next);
    return { text: `C(${renderNodes(a.arg).trim()}, ${renderNodes(b.arg).trim()})`, next: b.next };
  }
  if (name === "sqrt") {
    const opt = takeOptional(nodes, after);
    const a = takeArg(nodes, opt.next);
    const body = renderNodes(a.arg).trim();
    const degree = opt.arg ? renderNodes(opt.arg).trim() : "";
    const sign = degree === "" || degree === "2" ? "√" : degree === "3" ? "∛" : degree === "4" ? "∜" : `${script(degree, true)}√`;
    return { text: sign + wrap(body), next: a.next };
  }
  if (name in BIG_OPS) {
    let j = after;
    let sub = "";
    let sup = "";
    for (;;) {
      while (isSpace(nodes[j]) || (nodes[j]?.k === "cmd" && IGNORED.has((nodes[j] as { name: string }).name))) j++;
      const m = nodes[j];
      if (m?.k === "sub" && !sub) {
        const a = takeArg(nodes, j + 1);
        sub = renderNodes(a.arg).trim();
        j = a.next;
      } else if (m?.k === "sup" && !sup) {
        const a = takeArg(nodes, j + 1);
        sup = renderNodes(a.arg).trim();
        j = a.next;
      } else break;
    }
    const op = BIG_OPS[name]!;
    if (!sub && !sup) return { text: op + (FUNCS.has(name) ? FN_GAP : ""), next: j };
    const subU = sub ? toScript(sub, false) : "";
    const supU = sup ? toScript(sup, true) : "";
    if (subU !== null && supU !== null) return { text: op + subU + supU + FN_GAP, next: j };
    const compact = (x: string) => x.replace(/\s+/g, "");
    const range = sup ? `${compact(sub)}…${compact(sup)}` : compact(sub);
    return { text: `${op}(${range})${FN_GAP}`, next: j };
  }
  if (FUNCS.has(name)) return { text: name + FN_GAP, next: after };
  if (name === "operatorname") {
    const a = takeArg(nodes, after);
    return { text: renderText(a.arg) + FN_GAP, next: a.next };
  }
  if (name === "mod" || name === "bmod") return { text: " mod ", next: after };
  if (name === "pmod") {
    const a = takeArg(nodes, after);
    return { text: ` (mod ${renderNodes(a.arg).trim()})`, next: a.next };
  }
  if (TEXT_CMDS.has(name)) {
    const a = takeArg(nodes, after);
    return { text: renderText(a.arg), next: a.next };
  }
  if (FONT_CMDS.has(name)) {
    const a = takeArg(nodes, after);
    return { text: renderNodes(a.arg), next: a.next };
  }
  if (name === "mathbb" || name === "Bbb") {
    const a = takeArg(nodes, after);
    const inner = renderNodes(a.arg);
    return { text: [...inner].map((c) => DOUBLE_STRUCK[c] ?? c).join(""), next: a.next };
  }
  if (name === "textcolor" || name === "colorbox") {
    const a = takeArg(nodes, after);
    const b = takeArg(nodes, a.next);
    return { text: renderNodes(b.arg), next: b.next };
  }
  if (ONE_ARG_DROPPED.has(name)) return { text: "", next: takeArg(nodes, after).next };
  if (name === "tag") {
    const a = takeArg(nodes, after);
    return { text: ` (${renderText(a.arg)})`, next: a.next };
  }
  if (name === "overset" || name === "underset" || name === "stackrel") {
    const a = takeArg(nodes, after);
    const b = takeArg(nodes, a.next);
    return { text: renderNodes(b.arg), next: b.next };
  }
  if (name === "underbrace" || name === "overbrace") {
    const a = takeArg(nodes, after);
    let j = a.next;
    while (isSpace(nodes[j])) j++;
    const body = renderNodes(a.arg);
    const m = nodes[j];
    if (m?.k === "sub" || m?.k === "sup") {
      const note = takeArg(nodes, j + 1);
      return { text: `${body} (${renderNodes(note.arg).trim()})`, next: note.next };
    }
    return { text: body, next: a.next };
  }
  const ACCENTS: Record<string, [string, boolean]> = {
    bar: ["̄", false], overline: ["̅", true], underline: ["̲", true], hat: ["̂", false],
    widehat: ["̂", false], tilde: ["̃", false], widetilde: ["̃", false], vec: ["⃗", false],
    overrightarrow: ["⃗", false], dot: ["̇", false], ddot: ["̈", false],
  };
  if (name in ACCENTS) {
    const [mark, each] = ACCENTS[name]!;
    const a = takeArg(nodes, after);
    return { text: combine(renderNodes(a.arg).trim(), mark, each), next: a.next };
  }
  if (name === "not") {
    const a = takeArg(nodes, after);
    const inner = renderNodes(a.arg);
    const negated: Record<string, string> = { "=": "≠", "∈": "∉", "≡": "≢", "⊂": "⊄", "⊆": "⊈", "<": "≮", ">": "≯", "≤": "≰", "≥": "≱" };
    return { text: negated[inner] ?? `${inner}̸`, next: a.next };
  }
  if (IGNORED.has(name)) {
    if (name === "left" || name === "right" || name === "middle" || /^[bB]igg?[lr]?$/.test(name)) {
      const m = nodes[after];
      if (m?.k === "char" && m.ch === ".") return { text: "", next: after + 1 };
    }
    return { text: "", next: after };
  }
  if (name in SYMBOLS) {
    const sym = SYMBOLS[name]!;
    // Пробел после \Delta в «\Delta P» — разделитель команды, а не пробел в формуле: ΔP, πr².
    let j = after;
    if (/^\p{L}$/u.test(sym)) {
      while (nodes[j]?.k === "char" && (nodes[j] as { ch: string }).ch === " ") j++;
      const m = nodes[j];
      const glue =
        (m?.k === "char" && /[\p{L}\p{N}]/u.test(m.ch)) ||
        (m?.k === "cmd" && /^\p{L}$/u.test(SYMBOLS[(m as { name: string }).name] ?? ""));
      if (!glue) j = after;
    }
    return { text: sym, next: j };
  }
  // Незнакомая команда: показываем имя без обратной косой — так хотя бы читается.
  return { text: name, next: after };
}

function renderNodes(nodes: Node[]): string {
  let out = "";
  for (let i = 0; i < nodes.length; ) {
    const n = nodes[i]!;
    switch (n.k) {
      case "char":
        out += n.ch === "~" ? " " : n.ch === "&" ? " " : n.ch === "\n" ? " " : n.ch;
        i++;
        break;
      case "group":
        out += renderNodes(n.nodes);
        i++;
        break;
      case "env":
        out += renderEnv(n.name, n.inner);
        i++;
        break;
      case "sup":
      case "sub": {
        const a = takeArg(nodes, i + 1);
        out += script(renderNodes(a.arg), n.k === "sup");
        i = a.next;
        break;
      }
      case "cmd": {
        const r = renderCmd(nodes, i);
        out += r.text;
        i = r.next;
        break;
      }
    }
  }
  return out;
}

const SCRIPT_CHARS = "\\u00B2\\u00B3\\u00B9\\u2070-\\u209F\\u1D2C-\\u1DBF\\u2C7C\\u2C7D";

function finish(s: string): string {
  return s
    .replace(new RegExp(`${FN_GAP}([${SCRIPT_CHARS}]+)`, "gu"), `$1${FN_GAP}`)
    .replace(new RegExp(`${FN_GAP}(?=[\\p{L}\\p{N}])`, "gu"), " ")
    .replaceAll(FN_GAP, "")
    .replace(/[ \t]{2,}/g, (m) => (m.length >= 4 ? "    " : " "))
    .replace(/ *\n */g, "\n");
}

function renderFragment(src: string): string {
  return renderNodes(parse(src).nodes);
}

/** Перевод одного фрагмента LaTeX-математики (без разделителей) в Unicode-текст. */
export function latexToUnicode(src: string): string {
  return finish(renderFragment(src)).trim();
}

/** Голые команды вне $…$: \frac{a}{b}, \sqrt{x}, \cdot, \leq и т. п. */
const BARE_CMD = /\\(?:[A-Za-z]+)(?![A-Za-z])/g;

function convertBare(text: string): string {
  if (!text.includes("\\")) return convertScripts(text);
  let out = "";
  let last = 0;
  BARE_CMD.lastIndex = 0;
  for (let m = BARE_CMD.exec(text); m; m = BARE_CMD.exec(text)) {
    const name = m[0].slice(1);
    const known =
      name in SYMBOLS || FUNCS.has(name) || name in BIG_OPS || TEXT_CMDS.has(name) || FONT_CMDS.has(name) ||
      ["frac", "dfrac", "tfrac", "sqrt", "binom", "mathbb", "operatorname", "bar", "overline", "hat", "vec",
        "tilde", "dot", "ddot", "left", "right", "not", "pmod", "mod", "begin"].includes(name);
    if (!known) continue;
    const start = m.index;
    const end = atomEnd(text, start);
    out += text.slice(last, start) + finish(renderFragment(text.slice(start, end)));
    last = end;
    BARE_CMD.lastIndex = end;
  }
  return convertScripts(out + text.slice(last));
}

/** Конец «атома» с начала команды: аргументы в {…}/[…] и хвост из ^/_ с аргументами. */
function atomEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && /[A-Za-z]/.test(text[i]!)) i++;
  const name = text.slice(start + 1, i);
  if (name === "begin") {
    const env = /^\s*\{([A-Za-z]+\*?)\}/.exec(text.slice(i));
    if (env) {
      const { end } = findEnvEnd(text, i + env[0].length, env[1]!);
      return end < 0 ? text.length : end;
    }
  }
  if (name === "left") {
    // \right, но не \rightarrow и не \rightleftharpoons.
    const re = /\\right(?![A-Za-z])/g;
    re.lastIndex = i;
    const m = re.exec(text);
    if (m) {
      const close = m.index;
      return Math.min(text.length, close + "\\right".length + (text[close + 6] === "\\" ? 2 : 1));
    }
  }
  const skipGroup = (pos: number, open: string, close: string): number => {
    if (text[pos] !== open) return pos;
    let depth = 0;
    for (let j = pos; j < text.length; j++) {
      if (text[j] === open) depth++;
      else if (text[j] === close && --depth === 0) return j + 1;
    }
    return text.length;
  };
  for (;;) {
    const before = i;
    i = skipGroup(i, "[", "]");
    i = skipGroup(i, "{", "}");
    if (i === before) break;
  }
  while (text[i] === "^" || text[i] === "_") {
    i++;
    if (text[i] === "{") i = skipGroup(i, "{", "}");
    else if (text[i] === "\\") {
      i++;
      while (i < text.length && /[A-Za-z]/.test(text[i]!)) i++;
    } else i++;
  }
  return i;
}

/**
 * x^2, x^{n+1}, a_{ij}, x_1 в обычном тексте → x², xⁿ⁺¹, aᵢⱼ, x₁. Основа — одна буква, число или скобка:
 * var_1, snake_case и my^var не трогаем.
 */
function convertScripts(text: string): string {
  return text
    .replace(/(?<=(?:^|[^\p{L}\p{N}_])\p{L}|\p{N}|[)\]])\^(\{[^{}\n]{1,40}\}|-?\d+|[A-Za-z](?![A-Za-z0-9]))/gu, (_m, g: string) => {
      const raw = g.startsWith("{") ? g.slice(1, -1) : g;
      return script(latexToUnicode(raw), true);
    })
    .replace(/(?<=(?:^|[^\p{L}\p{N}_])\p{L}|[)\]])_(\{[^{}\n]{1,40}\}|\d+(?![A-Za-z])|[a-z](?![A-Za-z0-9]))/gu, (m, g: string) => {
      const raw = g.startsWith("{") ? g.slice(1, -1) : g;
      const uni = toScript(latexToUnicode(raw), false);
      return uni ?? m.replace(/[{}]/g, "");
    });
}

/** Встроенная формула $…$: открывающий $ без пробела справа, закрывающий без пробела слева и не перед цифрой. */
const INLINE_DOLLAR = /(?<![\\$\p{L}\p{N}])\$(?=\S)((?:\\\$|[^$\n]){1,400}?)(?<=\S)\$(?![\p{N}$])/gu;

function convertSegment(text: string): string {
  let s = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => `\n${latexToUnicode(inner)}\n`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => `\n${latexToUnicode(inner)}\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => latexToUnicode(inner))
    .replace(INLINE_DOLLAR, (_m, inner: string) => latexToUnicode(inner));
  s = convertBare(s);
  return s.replace(/\n{3,}/g, "\n\n");
}

/** Код (```…``` и `…`), адреса ссылок и голые URL оставляем как есть, остальное — через convertSegment. */
export function convertMath(text: string): string {
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`|\]\([^)\s]+\)|https?:\/\/[^\s)>\]]+)/g);
  return parts.map((p, idx) => (idx % 2 === 1 ? p : convertSegment(p))).join("");
}
