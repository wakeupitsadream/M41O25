#!/bin/sh
# Ignored Build Step проекта бота (Root Directory = max-bot): exit 0 — пропустить, exit 1 — собирать.
# Собираем, только если с прошлой успешной сборки менялась папка max-bot/. Неясность — собираем.
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$prev" ] || exit 1
[ "$prev" != "$(git rev-parse HEAD 2>/dev/null)" ] || exit 1
git cat-file -e "${prev}^{commit}" 2>/dev/null || exit 1
if git diff --quiet "$prev" HEAD -- . 2>/dev/null; then
  echo "max-bot/ не менялся с ${prev} — сборку бота пропускаем"
  exit 0
fi
exit 1
