/*
 * Кодировка TXT/CSV (docs/AI-CHAT.md §5). Файлы приходят отовсюду: UTF-8 с iPhone, «Юникод» (UTF-16LE с BOM)
 * из «Блокнота» и Excel «Текст Юникод», Windows-1251 со старых компьютеров колледжа. Чистая функция — тесты на байтах.
 */

/** Доля битых символов среди не-ASCII, до которой файл всё ещё UTF-8 (обрезанный хвост, склейка кусков). */
const UTF8_BROKEN_SHARE = 0.01;
/**
 * Короткому файлу 1 % не хватает даже на один символ: конспект на 50 букв с обрезанным на полуслове хвостом дал бы
 * 2 % битых. Поэтому до трёх битых прощаем, если правильной UTF-8 не-ASCII в десять раз больше, — у Windows-1251,
 * прочитанной как UTF-8, правильных последовательностей почти нет.
 */
const UTF8_BROKEN_FEW = 3;

const decode = (label: string, body: Uint8Array): string => new TextDecoder(label).decode(body);

/**
 * UTF-16 без BOM: латиница и цифры дают ноль в каждом втором байте. Кириллица в UTF-16LE — 0x04 во втором байте,
 * поэтому смотрим на нули, а не на конкретные значения; хватает первых 4 КБ.
 */
function utf16WithoutBom(body: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(body.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (body[i] === 0) evenZero++;
    if (body[i + 1] === 0) oddZero++;
  }
  const half = n / 2;
  if (oddZero > half * 0.3 && evenZero < half * 0.05) return "utf-16le";
  if (evenZero > half * 0.3 && oddZero < half * 0.05) return "utf-16be";
  return null;
}

/**
 * Байты → текст. BOM решает сразу (UTF-8, UTF-16LE, UTF-16BE). Без BOM — UTF-8, если битых последовательностей
 * мало (меньше 1 %, в коротком файле — до трёх): один случайный байт в конце не должен превращать всю кириллицу
 * в «РџСЂРёРІРµС‚». Доля считается от не-ASCII символов, а не от всех: в файле из Windows-1251, где на 10 000
 * символов латиницы одна русская фраза, битые — все её буквы, и это 100 % кириллицы, а не 0,2 % файла.
 * Иначе — Windows-1251.
 */
export function decodeText(body: Uint8Array): string {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return decode("utf-8", body.subarray(3));
  if (body[0] === 0xff && body[1] === 0xfe) return decode("utf-16le", body.subarray(2));
  if (body[0] === 0xfe && body[1] === 0xff) return decode("utf-16be", body.subarray(2));
  const wide = utf16WithoutBom(body);
  if (wide) return decode(wide, body);

  const utf8 = decode("utf-8", body);
  let broken = 0;
  let nonAscii = 0;
  for (let i = 0; i < utf8.length; i++) {
    const c = utf8.charCodeAt(i);
    if (c === 0xfffd) broken++;
    else if (c > 0x7f) nonAscii++;
  }
  const rare = broken <= Math.max(UTF8_BROKEN_FEW, (broken + nonAscii) * UTF8_BROKEN_SHARE) && nonAscii >= broken * 10;
  if (broken === 0 || rare) return utf8;
  try {
    return decode("windows-1251", body);
  } catch {
    return utf8;
  }
}
