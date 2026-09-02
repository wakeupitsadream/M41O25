const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)]|(?<![\w@])(?:t\.me|vk\.com)\/[^\s<]+)/gi;

/** Текст с сохранением переносов; ссылки становятся кликабельными. */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <a key={i} href={part.startsWith("http") ? part : `https://${part}`} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
            {part.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
