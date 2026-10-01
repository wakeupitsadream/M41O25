"use client";

import { useEffect } from "react";

/**
 * Последний рубеж: ошибка в корневом layout (шрифты, ChunkReload) — app/error.tsx уже не отрисуется, а дефолтный
 * «Application error» Next ничего не объясняет и не даёт выхода. Глобального CSS здесь нет (layout упал), поэтому
 * стили инлайном и цвета токенов из globals.css продублированы литералами. Роутер тоже под вопросом —
 * выход только полной перезагрузкой и обычной ссылкой.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 2rem",
          background: "#0a0a0e",
          color: "#f4f4f6",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: 320 }}>
          <h1 style={{ margin: "0 0 0.5rem", fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>Что-то сломалось</h1>
          <p style={{ margin: "0 0 1.25rem", fontSize: 15, lineHeight: 1.5, color: "#9c9ca8" }}>
            Перезагрузи страницу. Если не помогает — закрой приложение и открой снова или войди заново.
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{
              minHeight: 44,
              padding: "0.75rem 1.5rem",
              border: 0,
              borderRadius: 9999,
              background: "#c8ff2e",
              color: "#0a0a0e",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            Перезагрузить
          </button>
          <a href="/enter" style={{ display: "block", marginTop: "1rem", fontSize: 13, color: "#82828e", textDecoration: "underline", textUnderlineOffset: 4 }}>
            Войти заново
          </a>
          {error.digest && <div style={{ marginTop: "1rem", fontSize: 11, color: "#82828e" }}>код {error.digest} — назови его админу</div>}
        </main>
      </body>
    </html>
  );
}
