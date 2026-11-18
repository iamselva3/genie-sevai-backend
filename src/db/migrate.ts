import { Customer } from '../models';

/**
 * One-off changes to an existing database, run on every start (each step is a no-op once done).
 */
export async function migrate() {
  // Customers used to sign in with a phone OTP, so the phone number was unique. They now sign in with
  // Google and the phone is only a contact number, so the old unique index has to go.
  const indexes = await Customer.collection.indexes().catch(() => []);
  if (indexes.some((i) => i.name === 'phone_1' && i.unique)) {
    await Customer.collection.dropIndex('phone_1');
    console.log('[db] dropped the old unique index on customers.phone');
  }
  await Customer.createIndexes();
}
