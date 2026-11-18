import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SEED_ON_BOOT = 'false';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'sevai-test-uploads');
// Never touch the real R2 bucket or Google from tests (a developer's .env may have the keys).
process.env.STORAGE_DRIVER = 'local';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_ALLOWED_CLIENT_IDS = '';
process.env.GOOGLE_TEST_SECRET = 'jest-google-test-secret';
