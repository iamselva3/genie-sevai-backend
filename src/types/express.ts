import type { AdminUserDoc, CustomerDoc, ProfessionalDoc } from '../models';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: CustomerDoc;
      staff?: AdminUserDoc;
      pro?: ProfessionalDoc;
    }
  }
}

export {};
