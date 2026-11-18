import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SEED_ON_BOOT = 'false';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'sevai-test-uploads');
