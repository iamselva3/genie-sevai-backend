import type { NextFunction, Request, Response } from 'express';
import { AdminUser, Customer, Professional, StaffRole } from '../models';
import { verifyToken } from '../services/tokens';
import { forbidden, unauthorized } from '../utils/errors';

function bearer(req: Request) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7).trim());
}

export async function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token || token.kind !== 'customer') throw unauthorized();
  const customer = await Customer.findById(token.sub);
  if (!customer) throw unauthorized();
  if (customer.isBlocked) throw forbidden('Your account is on hold. Please contact support.');
  req.customer = customer;
  next();
}

/** Attaches the customer when a valid token is sent, but never rejects. */
export async function optionalCustomer(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (token?.kind === 'customer') {
    const customer = await Customer.findById(token.sub);
    if (customer && !customer.isBlocked) req.customer = customer;
  }
  next();
}

export function requireStaff(...roles: StaffRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token || token.kind !== 'staff') throw unauthorized('Please sign in to the admin panel');
    const user = await AdminUser.findById(token.sub);
    if (!user || !user.isActive) throw unauthorized('Your admin access has ended');
    if (roles.length && !roles.includes(user.role)) throw forbidden('Only an admin can do this');
    req.staff = user;
    next();
  };
}

export async function requirePro(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token || token.kind !== 'pro') throw unauthorized('Please sign in as a professional');
  const pro = await Professional.findById(token.sub);
  if (!pro || pro.status !== 'active') throw unauthorized('Your professional account is not active');
  req.pro = pro;
  next();
}
