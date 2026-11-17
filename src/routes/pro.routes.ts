import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requirePro } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { ACTIVE_JOB_STATUSES, Booking, Category, City, Professional, ProfessionalDoc } from '../models';
import { advanceStatus, presentForPro } from '../services/bookingFlow';
import { checkPassword, signToken } from '../services/tokens';
import { notFound, unauthorized } from '../utils/errors';
import { parse, phone } from '../utils/validate';

const router = Router();

async function presentSelf(pro: ProfessionalDoc) {
  const [city, skills] = await Promise.all([City.findById(pro.city), Category.find({ _id: { $in: pro.skills } })]);
  return {
    id: String(pro._id),
    name: pro.name,
    phone: pro.phone,
    city: city ? { id: String(city._id), name: city.name } : null,
    skills: skills.map((s) => ({ id: String(s._id), name: s.name })),
    rating: pro.rating,
    ratingCount: pro.ratingCount,
    jobsCompleted: pro.jobsCompleted,
    experienceYears: pro.experienceYears,
    role: 'professional' as const,
  };
}

router.post('/auth/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ phone, password: z.string().min(1, 'Enter your password').max(100) }), req.body);
  const pro = await Professional.findOne({ phone: body.phone });
  if (!pro || !(await checkPassword(body.password, pro.passwordHash))) throw unauthorized('Wrong phone number or password');
  if (pro.status !== 'active') throw unauthorized('Your account is not active. Contact your manager.');
  pro.lastLoginAt = new Date();
  await pro.save();
  res.json({ token: signToken({ sub: String(pro._id), kind: 'pro' }), user: await presentSelf(pro) });
});

router.get('/me', requirePro, async (req, res) => {
  res.json({ user: await presentSelf(req.pro!) });
});

router.get('/jobs', requirePro, async (req, res) => {
  const { scope } = parse(z.object({ scope: z.enum(['active', 'history']).default('active') }), req.query);
  const filter =
    scope === 'active'
      ? { professional: req.pro!._id, status: { $in: ACTIVE_JOB_STATUSES } }
      : { professional: req.pro!._id, status: { $in: ['completed', 'cancelled'] } };
  const jobs = await Booking.find(filter)
    .sort({ 'slot.start': scope === 'active' ? 1 : -1 })
    .limit(100)
    .populate('customer', 'name phone');
  res.json({ jobs: jobs.map(presentForPro) });
});

router.post('/jobs/:id/status', requirePro, async (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(['on_the_way', 'in_progress', 'completed']),
      pin: z.string().trim().regex(/^\d{4}$/, 'Enter the 4-digit PIN').optional(),
      note: z.string().trim().max(300).optional(),
    }),
    req.body,
  );
  if (!isValidObjectId(String(req.params.id))) throw notFound('Job');
  const booking = await Booking.findOne({ _id: String(req.params.id), professional: req.pro!._id });
  if (!booking) throw notFound('Job');
  await advanceStatus(booking, body.status, 'professional', { pin: body.pin, note: body.note, requirePin: true });
  await booking.populate('customer', 'name phone');
  res.json({ job: presentForPro(booking) });
});

export default router;
