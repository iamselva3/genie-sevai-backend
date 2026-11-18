import { createApp } from './app';
import { config } from './config';
import { connectDb } from './db/connection';
import { migrate } from './db/migrate';
import { Category } from './models';
import { runSeed } from './seed/seed';

export async function startServer(mongoUri = config.mongoUri, port = config.port) {
  await connectDb(mongoUri);
  console.log(`[db] connected`);
  await migrate();

  if (config.seedOnBoot && (await Category.estimatedDocumentCount()) === 0) {
    const summary = await runSeed({ demoBookings: !config.isProduction });
    console.log(`[seed] empty database seeded:`, summary);
  }

  const app = createApp();
  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[api] Genie Sevai API listening on http://localhost:${port}/api/v1`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[api] failed to start', err);
    process.exit(1);
  });
}
