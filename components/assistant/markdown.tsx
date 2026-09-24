"use client";

import { memo, useSyncExternalStore, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { imagePlaceholder, linkView } from "@/lib/assistant/client/links";

/*
 * Ответ помощника в markdown: списки, таблицы, код (docs/AI-CHAT.md §8). Модуль грузится динамически
 * (chat-screen.tsx), чтобы react-markdown с remark не попадал в общий бандл. Текст модели недоверенный: в её
 * контекст попадает то, что пишут одногруппники (дополнения к домашке, анонимные вопросы), а значит, и чужие
 * инструкции. Сырой HTML react-markdown показывает текстом, опасные схемы режет defaultUrlTransform; картинки
 * и ссылки — ниже.
 */

const noop = () => () => {};
/** origin известен только в браузере; на сервере null — linkView тогда считает внешней любую абсолютную ссылку. */
const useOrigin = () =>
  useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => null,
  );

type HastLike = { type?: unknown; value?: unknown; children?: unknown };

/** Видимый текст ссылки по её узлу hast: children-реакт-узлы могут быть <strong> и <code>, а узел — всегда текст. */
function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as HastLike;
  if (n.type === "text" && typeof n.value === "string") return n.value;
  return Array.isArray(n.children) ? n.children.map(textOf).join("") : "";
}

/**
 * Ссылка из ответа. Внешняя — с хостом рядом с текстом («Задание (attacker.tld)»): инструкция от одногруппника
 * в контексте модели может попросить спрятать под текст адрес с пересказом беседы, и один тап отдал бы его
 * чужому серверу. Открывается только тапом, без предзагрузки и без Referer. Обычная ссылка без target=_blank:
 * установленная PWA на iPhone сама откроет внешний адрес поверх приложения, а новое окно без нашей cookie ничего
 * не даст. Цвет не акцентный — акцент только у «сейчас» и CTA.
 */
function MdLink({ href, node, children }: { href?: string; node?: unknown; children?: ReactNode }) {
  const view = linkView(href, textOf(node), useOrigin());
  if (view.kind === "text") return <>{children}</>;
  const cls = "font-medium underline decoration-dim underline-offset-2 [overflow-wrap:anywhere]";
  if (view.kind === "internal") {
    return (
      <a href={view.href} className={cls}>
        {children}
      </a>
    );
  }
  // Подчёркнут только текст ссылки: хост — пояснение к ней, а не её часть. Вся строка остаётся одной целью для тапа.
  return (
    <a href={view.href} rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="font-medium [overflow-wrap:anywhere]">
      <span className="underline decoration-dim underline-offset-2">{children}</span>
      {view.label && <span className="font-normal text-dim"> ({view.label})</span>}
    </a>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: MdLink,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-dim">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-dim">{children}</ol>,
  h1: ({ children }) => <h3 className="mb-1.5 mt-4 font-display text-[17px] font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-4 font-display text-[16px] font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 text-[15px] font-bold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-[15px] font-semibold first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  // Таблица шире экрана скроллится сама по себе, а не растягивает страницу вбок. Внутри таблицы перенос только
  // по словам: с унаследованным overflow-wrap:anywhere колонки сжимались бы до буквы и скролл не включался бы никогда.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md hairline">
      <table className="min-w-full border-collapse text-[14px] leading-snug [overflow-wrap:normal]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2.5 py-1.5 align-top">{children}</td>,
  // Блок кода: свой фон и горизонтальный скролл; вложенный <code> теряет оформление строчного кода.
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-[13px] leading-snug hairline [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
  ),
  code: ({ children }) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  // Картинку не рисуем вовсе: <img> сам, без тапа, сходил бы на чужой сервер, а в адресе модель по чужой
  // инструкции может передать что угодно из беседы (плюс IP телефона). Вместо неё — подпись.
  img: ({ alt }) => <span className="text-muted">{imagePlaceholder(alt)}</span>,
};

const plugins = [remarkGfm];

function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="[overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** memo: во время стрима перерисовывается только идущий ответ, а не вся лента. */
const Markdown = memo(MarkdownImpl);
export default Markdown;
