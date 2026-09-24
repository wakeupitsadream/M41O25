import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXmlString, SaxParser, type SaxHandler, type SaxTag } from "./extract-sax";

/** Записывает события в строку: «<p id=1>», «"текст"», «</p>». */
function recorder(attrs: string[] = []): SaxHandler & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    open(name: string, tag: SaxTag) {
      const a = attrs.map((k) => [k, tag.attr(k)] as const).filter(([, v]) => v !== null);
      log.push(`<${name}${a.map(([k, v]) => ` ${k}=${v}`).join("")}>`);
    },
    close(name: string) {
      log.push(`</${name}>`);
    },
    text(s: string) {
      if (log.length && log[log.length - 1].startsWith('"')) log[log.length - 1] = `${log[log.length - 1].slice(0, -1)}${s}"`;
      else log.push(`"${s}"`);
    },
  };
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- комментарий <w:t>не текст</w:t> -->
<w:document xmlns:w="urn:w" xmlns:r="urn:r"><w:body><w:p w:rsidR="00A1"><w:r><w:t xml:space="preserve">P &amp; Q &lt; 10 &#1071;&#x44F; </w:t></w:r><w:r><w:t><![CDATA[<сырой> & текст]]></w:t></w:r></w:p><w:tbl/><w:hyperlink r:id="rId5" w:tooltip="a > b"><w:t>ссылка</w:t></w:hyperlink></w:body></w:document>`;

test("SaxParser: локальные имена, сущности и числовые ссылки, CDATA, комментарии и инструкции пропущены, «>» в атрибуте", () => {
  const h = recorder(["id", "tooltip", "rsidR"]);
  parseXmlString(XML, h);
  assert.deepEqual(h.log, [
    '"\n\n"',
    "<document>",
    "<body>",
    "<p rsidR=00A1>",
    "<r>",
    "<t>",
    '"P & Q < 10 Яя "',
    "</t>",
    "</r>",
    "<r>",
    "<t>",
    '"<сырой> & текст"',
    "</t>",
    "</r>",
    "</p>",
    "<tbl>",
    "</tbl>",
    "<hyperlink id=rId5 tooltip=a > b>",
    "<t>",
    '"ссылка"',
    "</t>",
    "</hyperlink>",
    "</body>",
    "</document>",
  ]);
});

test("SaxParser: любое разбиение на куски даёт те же события, что и строка целиком", () => {
  const whole = recorder(["id", "tooltip", "rsidR"]);
  parseXmlString(XML, whole);
  for (let size = 1; size <= 40; size += 3) {
    const h = recorder(["id", "tooltip", "rsidR"]);
    const p = new SaxParser(h);
    for (let i = 0; i < XML.length; i += size) p.write(XML.slice(i, i + size));
    p.end();
    assert.deepEqual(h.log, whole.log, `кусками по ${size}`);
  }
});

test("SaxParser: сущности из DOCTYPE не раскрываются («миллиард смешков» невозможен)", () => {
  const evil = `<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><x><t>&b;</t><t>норм</t></x>`;
  const h = recorder();
  parseXmlString(evil, h);
  assert.deepEqual(h.log, ["<x>", "<t>", '"&b;"', "</t>", "<t>", '"норм"', "</t>", "</x>"]);
});

test("SaxParser: xmlns-объявления не путаются с атрибутами (xmlns:r и r=\"A1\")", () => {
  const h = recorder(["r"]);
  parseXmlString(`<c xmlns:r="urn:r" r="A1"/><c xmlns:r="urn:r"/>`, h);
  assert.deepEqual(h.log, ["<c r=A1>", "</c>", "<c>", "</c>"]);
});

test("SaxParser: done останавливает разбор, гигантский тег без «>» — overflow, а не рост буфера", () => {
  let opened = 0;
  const h: SaxHandler & { done: boolean } = {
    done: false,
    open() {
      opened++;
      if (opened === 3) this.done = true;
    },
  };
  const p = new SaxParser(h);
  p.write("<a/><b/><c/><d/><e/>");
  assert.equal(opened, 3);
  assert.equal(p.stopped, true);

  const q = new SaxParser({});
  q.write(`<a x="`);
  for (let i = 0; i < 80 && !q.stopped; i++) q.write("y".repeat(16 * 1024));
  assert.equal(q.overflow, true);
});
