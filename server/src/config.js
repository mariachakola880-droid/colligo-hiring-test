const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  businessTz: process.env.BUSINESS_TZ || 'Asia/Kolkata',
};
