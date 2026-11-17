/* Runs the API against a throw-away in-memory MongoDB (seeded on boot).
   Handy for trying the project without installing MongoDB, and used by the Playwright suite. */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('sevai');
  process.env.SEED_ON_BOOT = 'true';

  // Import after env is set so config picks it up.
  const { startServer } = await import('../server');
  const server = await startServer(process.env.MONGO_URI);

  const shutdown = async () => {
    server.close();
    await mongod.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
