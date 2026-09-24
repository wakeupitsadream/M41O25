/** Число из env: пусто, не число или ≤ 0 → умолчание. */
const positiveNumber = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

// Вынесено из литерала env: геттер assistant.configured читает соседний блок, а `this` внутри вложенного объекта — это сам блок.
const polza = {
  apiKey: process.env.POLZA_API_KEY ?? "",
  baseUrl: process.env.POLZA_BASE_URL ?? "https://polza.ai/api/v1",
  model: process.env.OCR_MODEL ?? "google/gemini-3.5-flash",
  strongModel: process.env.OCR_MODEL_STRONG ?? "anthropic/claude-sonnet-5",
  mock: process.env.OCR_MOCK === "1",
};

export const env = {
  tz: process.env.APP_TZ ?? "Asia/Yekaterinburg",
  authSecret: process.env.AUTH_SECRET ?? "",
  anonPepper: process.env.ANON_PEPPER ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  /** healthchecks.io (или аналог): cron пингует после каждого запуска, /fail — при ошибке. */
  healthcheckUrl: process.env.HEALTHCHECK_URL ?? "",
  /**
   * Web Push (VAPID). Публичный ключ нужен и клиенту (NEXT_PUBLIC_), приватный — только серверу.
   * Ключей нет → пуши выключены целиком: подписка не предлагается, отправка молча пропускается.
   */
  push: {
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "",
    get configured() {
      return Boolean(this.publicKey && this.privateKey && this.subject);
    },
  },
  polza,
  /**
   * Помощник по учёбе (docs/AI-CHAT.md §4). Ключ, baseUrl и mock — общие с OCR (env.polza): OCR_MOCK=1 включает
   * заготовленные ответы и для помощника — CI и локальная разработка без ключа. Курс и наценка нужны только для
   * себестоимости в админке, поэтому кривое значение не роняет запуск, а тихо откатывается к умолчанию.
   */
  assistant: {
    model: process.env.ASSISTANT_MODEL ?? "google/gemini-3.5-flash-lite",
    strongModel: process.env.ASSISTANT_MODEL_STRONG ?? "anthropic/claude-sonnet-5",
    usdRub: positiveNumber(process.env.ASSISTANT_USD_RUB, 85),
    polzaMarkup: positiveNumber(process.env.ASSISTANT_POLZA_MARKUP, 1.25),
    get configured() {
      return Boolean(polza.apiKey) || polza.mock;
    },
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "raspison",
    get configured() {
      return Boolean(this.accountId && this.accessKeyId && this.secretAccessKey);
    },
  },
};
