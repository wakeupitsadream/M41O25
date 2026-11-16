import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import type { Router } from "../llm/router.js";
import type { MaxClient } from "../max/client.js";

export type Deps = {
  config: Config;
  max: MaxClient;
  store: Store;
  router: Router;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Момент, к которому обработка события должна закончиться (дедлайн функции Vercel минус запас). */
  deadline: number;
};
