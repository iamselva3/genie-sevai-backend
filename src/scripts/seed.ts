/* Usage: npm run seed            -> seeds an empty database
          npm run seed -- --reset -> wipes the database first (development only) */
import mongoose from 'mongoose';
import { config } from '../config';
import { connectDb, disconnectDb } from '../db/connection';
import { Category } from '../models';
import { runSeed } from '../seed/seed';

async function main() {
  const reset = process.argv.includes('--reset');
  await connectDb(config.mongoUri);
  if (reset) {
    if (config.isProduction) throw new Error('Refusing to reset a production database');
    await mongoose.connection.dropDatabase();
    console.log('[seed] database wiped');
  }
  if ((await Category.estimatedDocumentCount()) > 0) {
    console.log('[seed] database already has data. Use --reset to start over.');
  } else {
    console.log('[seed] done:', await runSeed({ demoBookings: !config.isProduction }));
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
