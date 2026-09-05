import { buildApp } from './api/app.js';
import type { Config } from './config.js';
import { openStorage } from './storage/database.js';

export async function serve(config: Config): Promise<void> {
  const app = buildApp(config, openStorage(config.databasePath));
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  const stop = () => {
    const deadline = setTimeout(() => process.exit(1), 10_000).unref();
    void app
      .close()
      .then(() => {
        clearTimeout(deadline);
      })
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
