# Raspison — правила проекта для Claude Code

PWA группы М41О25 (РАНХиГС, Оренбург): расписание, домашка, жизнь группы. 21 пользователь на iPhone, один оператор (Максим). Production живёт на `raspison.vercel.app`, база — Neon, файлы — Cloudflare R2, распознавание сканов — PolzaAI. Планы и решения: `docs/PLAN.md`, `docs/BRIEF.md`, `docs/ROADMAP.md`; эксплуатация: `README.md`, `docs/RUNBOOK.md`.

## Стек и команды

Next.js 15.5 App Router (React 19, Server Actions), TypeScript strict, Tailwind 4 (CSS-first токены в `app/globals.css`), Motion, Drizzle ORM + `pg`, Serwist (service worker `app/sw.ts`), Zod 4, next/og.

```bash
npm run dev                 # turbopack, SW отключён
npm run typecheck && npm run lint
npm test                    # unit-тесты чистой логики lib/**/*.test.ts (node:test через tsx)
npm run db:check            # drizzle-kit check: миграции согласованы со схемой
npm run build               # scripts/build.mjs → next build (webpack, нужен для Serwist)
npm run db:generate         # drizzle-kit generate после правки lib/db/schema.ts
npm run db:migrate          # применить drizzle/*.sql к DATABASE_URL
npm run db:seed -- --demo   # группа + админ + 20 студентов + расписание (локально)
npm run e2e                 # Playwright-скрипты e2e/*.mjs против dev/prod-сервера (см. ниже)
npm run e2e:offline         # только против production-сборки на :3001
```

Локально нужен Postgres (`DATABASE_URL` в `.env.local`), `OCR_MOCK=1`, без R2 файлы падают в `.data/uploads`. В песочнике разработки Chromium лежит в `/opt/pw-browsers/chromium` → `PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`; на обычной машине `npx playwright install chromium` и без переменной.

## Ветки и деплой

- `main` — production. Push в `main` = production-сборка на Vercel: `scripts/build.mjs` применяет миграции к `DATABASE_URL` и при заданном `SEED_ADMIN_NAME` создаёт группу и админа, потом `next build`. Любая другая ветка — preview без миграций (если не задан `MIGRATE_ON_BUILD=1`).
- Рабочие ветки `claude/*`; в `main` только после `typecheck`, `lint`, `db:check`, `test`, `build` и e2e. То же самое на каждый push и PR делает GitHub Actions (`.github/workflows/ci.yml`, с Postgres-сервисом и e2e против production-сборки). Никогда не force-push в `main`.
- Секреты только в Vercel → Environment Variables. В репозитории публичном (решение Максима) — никаких ключей, скриншотов с реальными людьми, реальных сканов, значений `SEED_*`.
- Регион функций `fra1` (`vercel.json`), cron `/api/cron/daily` в 23:00 UTC работает только на production.

## Время

Группа живёт в `Asia/Yekaterinburg`; сервер Vercel — UTC. Даты в базе и в URL — строки `YYYY-MM-DD`, время пар — `HH:MM`.
- Сервер: только `lib/tz.ts` (`todayIso`, `mondayIso`, `addDaysIso`, `nowHm`, `parseLocalDateTime`). Никогда `new Date().toISOString().slice(0, 10)`.
- Клиент: `lib/schedule/time.ts` (`nowParts`, `mondayOf`, `addDaysIso`, `fmt*`) с `NEXT_PUBLIC_APP_TZ`.
- Одноимённые `addDaysIso` в этих модулях работают в разных контекстах; не смешивать импорты (серверный код → `lib/tz`).

## Серверные действия и данные

- Действия возвращают `ActionResult` (`ok()` / `fail()` из `lib/utils.ts`), не бросают исключения на ошибках валидации; редирект только после успеха. Авторизация в каждом действии через `actionUser(minRole)`; роли `student < moderator < admin`.
- Многотабличные записи — в `db.transaction`. Переключатели (галочки, реакции) — одним запросом с `on conflict`.
- Правки схемы: изменить `lib/db/schema.ts` → `npm run db:generate` → проверить SQL → закоммитить `.sql` и `drizzle/meta` вместе. Применённые миграции не редактировать. Миграции обратно совместимы с предыдущим деплоем: сначала добавляем nullable/с дефолтом, удаляем и переименовываем в следующем релизе.
- `lib/env.ts` — единственный читатель `process.env` (кроме `NEXT_PUBLIC_*` на клиенте и `VERCEL*` в сборке). Подключение к базе ленивое (`lib/db/index.ts`): импорт модуля без `DATABASE_URL` не падает — это нужно сборке.
- Инвайт-код сравнивается канонизированным (`lib/invite.ts`): кириллические двойники → латиница, дефисы игнорируются. Префикс кода всегда латиницей.
- Файлы отдаются только через `/api/files/[id]`; ссылки для внешнего браузера подписываются `lib/files/token.ts` (`fileHref`). Установленная PWA на iPhone открывает внешние ссылки без cookie — фото показываем через `ImageGrid`, а не `target="_blank"`.

## UI и iPhone

- Тёмная тема, акцент `#C8FF2E` только на «сейчас», сегодня, CTA. Компоненты в `components/ui/*`; шторка `Sheet` блокирует скролл через `body{position:fixed}`.
- Всё на телефоне: safe-area через `--sat/--sab`, тап-таргеты ≥ 40px, `dvh`, без hover-зависимого поведения. `-webkit-touch-callout` подавлен только на кнопках и drag-списках.
- Расписание — клиентский `ScheduleApp` с pushState-навигацией и офлайн-кешем (`/api/schedule` через SW и localStorage). Не ломать `additionalPrecacheEntries` для `/~offline`.

## Известные проблемы

- P0, обойдено, не решено: в production-сборке клиентская навигация, server action или `router.refresh()` иногда не коммитятся (URL не меняется, ошибок нет, RSC-ответ пришёл целиком) — React 19.1 внутри Next 15.5 теряет ping от ленивого чанка Flight, гонка на границах чанков потока. Вероятность растёт с объёмом страницы. Обход: `NavWatchdog` в лэйаутах и `useGuardedRouter` вместо `useRouter` во всех клиентских компонентах (правило проекта: `useRouter` из `next/navigation` напрямую не импортировать). Репро `e2e/nav-hang.mjs`, детали в `docs/ROADMAP.md`, раздел «Открытая проблема P0». Падающий `waitForURL` в e2e не считать флейком.

## Проверки перед push

`npm run typecheck && npm run lint && npm run db:check && npm test && npm run build`, затем e2e против production-сборки (`npx next start -p 3001`, `BASE=http://localhost:3001 PW_CHROMIUM=... npm run e2e`, `npm run e2e:offline`). Не запускать `npm audit fix --force` и мажорные обновления (Next 16, TS 7, ESLint 10, Motion 13) без отдельной сессии с полным прогоном.
