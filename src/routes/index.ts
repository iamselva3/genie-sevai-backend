import { Router } from 'express';
import { requireStaff } from '../middleware/auth';
import adminAuth from './admin/auth.routes';
import adminBookings from './admin/bookings.routes';
import adminCatalog from './admin/catalog.routes';
import adminOps from './admin/ops.routes';
import adminPeople from './admin/people.routes';
import customer from './customer.routes';
import pro from './pro.routes';
import publicRoutes from './public.routes';

const admin = Router();
// Login (open) and staff management (guarded per route) come first...
admin.use(adminAuth);
// ...everything after this needs a signed-in staff member.
admin.use(requireStaff());
admin.use(adminCatalog, adminBookings, adminPeople, adminOps);

const router = Router();
router.use('/', publicRoutes);
router.use('/', customer);
router.use('/pro', pro);
router.use('/admin', admin);

export default router;
