"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/*
 * Ответ помощника в markdown: списки, таблицы, код (docs/AI-CHAT.md §8). Модуль грузится динамически
 * (chat-screen.tsx), чтобы react-markdown с remark не попадал в общий бандл. Сырой HTML react-markdown не рендерит
 * по умолчанию, опасные схемы ссылок режет defaultUrlTransform — текст модели считаем недоверенным.
 */

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  // Обычная ссылка без target=_blank: установленная PWA на iPhone сама откроет внешний адрес поверх приложения,
  // а новое окно без нашей cookie ничего не даст. Цвет не акцентный — акцент только у «сейчас» и CTA.
  a: ({ href, children }) => (
    <a href={href} className="font-medium underline decoration-dim underline-offset-2 [overflow-wrap:anywhere]">
      {children}
    </a>
  ),
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
  // Картинки по внешним адресам не грузим: модель может сослаться на что угодно, а запрос с телефона раскрывает IP.
  img: ({ alt }) => (alt ? <span className="text-muted">[{alt}]</span> : null),
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
