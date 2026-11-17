import crypto from 'crypto';
import { config } from '../config';
import { Otp } from '../models';
import { AppError, badRequest } from '../utils/errors';

function hashCode(phone: string, code: string) {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${phone}:${code}`).digest('hex');
}

/**
 * Delivers the code to the customer. Plug an SMS gateway (MSG91, Twilio, Gupshup...) in here
 * before going live; until then codes are printed to the server log outside production.
 */
async function deliver(phone: string, code: string) {
  if (config.isTest) return;
  if (config.isProduction) {
    console.warn(`[otp] No SMS gateway configured - code for ${phone.slice(0, 2)}******${phone.slice(-2)} was not delivered`);
    return;
  }
  console.log(`[otp] ${phone} -> ${code}`);
}

export async function issueOtp(phone: string) {
  const existing = await Otp.findOne({ phone });
  if (existing && config.otp.resendCooldownSeconds > 0) {
    const waitMs = existing.lastSentAt.getTime() + config.otp.resendCooldownSeconds * 1000 - Date.now();
    if (waitMs > 0) {
      throw new AppError(429, `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another code`, 'OTP_COOLDOWN');
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await Otp.findOneAndUpdate(
    { phone },
    {
      phone,
      codeHash: hashCode(phone, code),
      expiresAt: new Date(Date.now() + config.otp.ttlSeconds * 1000),
      attempts: 0,
      lastSentAt: new Date(),
    },
    { upsert: true },
  );
  await deliver(phone, code);
  return { code, expiresIn: config.otp.ttlSeconds };
}

export async function verifyOtp(phone: string, code: string) {
  const record = await Otp.findOne({ phone });
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw badRequest('This code has expired. Request a new one.', 'OTP_EXPIRED');
  }
  if (record.attempts >= config.otp.maxAttempts) {
    await record.deleteOne();
    throw new AppError(429, 'Too many wrong attempts. Request a new code.', 'OTP_LOCKED');
  }
  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hashCode(phone, code), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    record.attempts += 1;
    await record.save();
    throw badRequest('That code is not right. Check and try again.', 'OTP_INVALID');
  }
  await record.deleteOne();
}
