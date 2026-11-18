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
  otp: {
    ttlSeconds: 300,
    maxAttempts: 5,
    resendCooldownSeconds: nodeEnv === 'production' ? 30 : 0,
    /** Outside production the code is returned in the API response so the flow can be tested without SMS. */
    exposeCode: !isProduction,
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
    /** Where uploaded pictures (banners) are stored; served at /uploads. */
    dir: path.resolve(env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')),
    maxBytes: 3 * 1024 * 1024,
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
    otpPerWindow: nodeEnv === 'production' ? 8 : 1000,
    loginPerWindow: nodeEnv === 'production' ? 20 : 1000,
  },
};
