import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireStaff } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import { AdminUser, AdminUserDoc, STAFF_ROLES } from '../../models';
import { checkPassword, hashPassword, signToken } from '../../services/tokens';
import { badRequest, notFound, unauthorized } from '../../utils/errors';
import { parse } from '../../utils/validate';

const router = Router();

const presentStaff = (u: AdminUserDoc) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt ?? null,
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  const body = parse(
    z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), password: z.string().min(1, 'Enter your password').max(100) }),
    req.body,
  );
  const user = await AdminUser.findOne({ email: body.email });
  if (!user || !(await checkPassword(body.password, user.passwordHash))) throw unauthorized('Wrong email or password');
  if (!user.isActive) throw unauthorized('Your admin access has ended');
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: signToken({ sub: String(user._id), kind: 'staff', role: user.role }), user: presentStaff(user) });
});

router.get('/auth/me', requireStaff(), (req, res) => {
  res.json({ user: presentStaff(req.staff!) });
});

/* ---------------- Staff accounts (admins only) ---------------- */

router.get('/staff', requireStaff('admin'), async (_req, res) => {
  const users = await AdminUser.find().sort({ createdAt: 1 });
  res.json({ users: users.map(presentStaff) });
});

router.post('/staff', requireStaff('admin'), async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80),
      email: z.string().trim().toLowerCase().email('Enter a valid email'),
      password: z.string().min(8, 'Use at least 8 characters').max(100),
      role: z.enum(STAFF_ROLES),
    }),
    req.body,
  );
  const user = await AdminUser.create({ ...body, passwordHash: await hashPassword(body.password) });
  res.status(201).json({ user: presentStaff(user) });
});

router.patch('/staff/:id', requireStaff('admin'), async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      role: z.enum(STAFF_ROLES).optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(8, 'Use at least 8 characters').max(100).optional(),
    }),
    req.body,
  );
  if (!isValidObjectId(req.params.id)) throw notFound('User');
  const user = await AdminUser.findById(req.params.id);
  if (!user) throw notFound('User');
  const self = user._id.equals(req.staff!._id);
  if (self && (body.isActive === false || (body.role && body.role !== 'admin'))) {
    throw badRequest('You cannot remove your own admin access', 'SELF_LOCKOUT');
  }
  if (body.name) user.name = body.name;
  if (body.role) user.role = body.role;
  if (body.isActive !== undefined) user.isActive = body.isActive;
  if (body.password) user.passwordHash = await hashPassword(body.password);
  await user.save();
  res.json({ user: presentStaff(user) });
});

export default router;
