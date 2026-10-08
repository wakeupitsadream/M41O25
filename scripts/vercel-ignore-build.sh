#!/bin/sh
# Ignored Build Step проекта raspison (vercel.json → ignoreCommand): exit 0 — сборку пропустить, exit 1 — собирать.
# Пропускаем, только если с прошлой успешной сборки этой ветки менялась одна папка max-bot/ — у бота свой проект
# Vercel. Любая неясность (первая сборка, Redeploy того же коммита, коммита нет в неполной истории клона,
# ошибка git) — собираем: лишняя сборка дешевле устаревшего production.
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$prev" ] || exit 1
[ "$prev" != "$(git rev-parse HEAD 2>/dev/null)" ] || exit 1
git cat-file -e "${prev}^{commit}" 2>/dev/null || exit 1
changed=$(git diff --name-only "$prev" HEAD 2>/dev/null) || exit 1
[ -n "$changed" ] || exit 1
if printf '%s\n' "$changed" | grep -qv '^max-bot/'; then exit 1; fi
echo "С ${prev} менялась только папка max-bot/ — сборку raspison пропускаем"
exit 0
