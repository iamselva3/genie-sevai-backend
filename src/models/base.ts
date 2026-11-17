import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

// Every model serialises with `id` instead of `_id` and never leaks secrets.
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.passwordHash;
    delete ret.codeHash;
    delete ret.pin;
    return ret;
  },
});

export default mongoose;
