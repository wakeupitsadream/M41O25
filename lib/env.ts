export const env = {
  tz: process.env.APP_TZ ?? "Asia/Yekaterinburg",
  authSecret: process.env.AUTH_SECRET ?? "",
  anonPepper: process.env.ANON_PEPPER ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  polza: {
    apiKey: process.env.POLZA_API_KEY ?? "",
    baseUrl: process.env.POLZA_BASE_URL ?? "https://polza.ai/api/v1",
    model: process.env.OCR_MODEL ?? "google/gemini-3.5-flash",
    strongModel: process.env.OCR_MODEL_STRONG ?? "anthropic/claude-sonnet-5",
    mock: process.env.OCR_MOCK === "1",
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
