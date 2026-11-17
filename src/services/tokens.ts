import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config';

export type TokenKind = 'customer' | 'staff' | 'pro';

export interface TokenPayload {
  sub: string;
  kind: TokenKind;
  role?: string;
}

const KINDS: TokenKind[] = ['customer', 'staff', 'pro'];

export function signToken(payload: TokenPayload): string {
  const expiresIn = (payload.kind === 'customer' ? config.customerTokenTtl : config.staffTokenTtl) as SignOptions['expiresIn'];
  return jwt.sign(payload, config.jwtSecret, { expiresIn, issuer: 'sevai' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { issuer: 'sevai' }) as jwt.JwtPayload;
    if (typeof decoded.sub !== 'string' || !KINDS.includes(decoded.kind)) return null;
    return { sub: decoded.sub, kind: decoded.kind, role: decoded.role };
  } catch {
    return null;
  }
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
