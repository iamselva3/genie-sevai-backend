import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

if (isProduction && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  port: parseInt(env.PORT || '5100', 10),
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  mongoUri: env.MONGO_URI || 'mongodb://127.0.0.1:27017/sevai',
  jwtSecret: env.JWT_SECRET || 'sevai_dev_only_secret_do_not_use_in_production_0123456789',
  customerTokenTtl: env.CUSTOMER_TOKEN_TTL || '30d',
  staffTokenTtl: env.STAFF_TOKEN_TTL || '12h',
  corsOrigins: (env.CORS_ORIGIN || 'http://localhost:5273,http://localhost:5274')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  seedOnBoot: (env.SEED_ON_BOOT ?? (isProduction ? 'false' : 'true')) === 'true',
  admin: {
    email: (env.ADMIN_EMAIL || 'admin@sevai.in').toLowerCase(),
    password: env.ADMIN_PASSWORD || 'Admin@12345',
  },
  /** Minutes east of UTC that slot dates/times are expressed in (330 = IST). */
  tzOffsetMinutes: parseInt(env.TZ_OFFSET_MINUTES || '330', 10),
  google: {
    /** OAuth client IDs whose Google tokens are accepted (GOOGLE_CLIENT_ID plus GOOGLE_ALLOWED_CLIENT_IDS). */
    clientIds: [env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_ALLOWED_CLIENT_IDS || '').split(',')]
      .map((id) => (id || '').trim())
      .filter(Boolean),
    /**
     * Tests only: lets the test suites sign in without Google (see services/google.ts).
     * Ignored when NODE_ENV=production.
     */
    testSecret: isProduction ? '' : env.GOOGLE_TEST_SECRET || '',
  },
  slots: {
    startHour: 8,
    endHour: 20,
    stepMinutes: 60,
    /** A slot must start at least this many minutes from now. */
    leadMinutes: 90,
    daysAhead: 7,
  },
  uploads: {
    /**
     * Where uploaded pictures (banners) go: 'r2' = the Cloudflare R2 bucket (needs the R2 keys below),
     * 'local' = the UPLOAD_DIR folder on this server. Defaults to r2 when the keys are set.
     */
    driver: (env.STORAGE_DRIVER || (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY ? 'r2' : 'local')).toLowerCase() as 'r2' | 'local',
    dir: path.resolve(env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')),
    maxBytes: 3 * 1024 * 1024,
    r2: {
      accountId: env.CLOUDFLARE_ACCOUNT_ID || '',
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      bucket: env.R2_BUCKET_NAME || 'sevai',
      /** Optional public address of the bucket (custom domain or r2.dev). Without it the API serves the pictures. */
      publicUrl: (env.R2_PUBLIC_DOMAIN || '').replace(/\/+$/, ''),
    },
  },
  pricing: {
    visitFee: 79,
    freeVisitAbove: 499,
  },
  booking: {
    /** Travel/cleanup buffer added after a job when checking a professional's calendar. */
    bufferMinutes: 30,
    /** Customers can reschedule until this many minutes before the slot. */
    rescheduleCutoffMinutes: 120,
    maxItems: 10,
    maxQty: 10,
  },
  rateLimit: {
    signInPerWindow: nodeEnv === 'production' ? 20 : 1000,
    loginPerWindow: nodeEnv === 'production' ? 20 : 1000,
  },
};
