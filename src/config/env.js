import { z } from 'zod';

function loadDotEnv() {
  if (process.env.NODE_ENV === 'test') return;
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  INTERSWITCH_MODE: z.enum(['TEST', 'LIVE']).default('TEST'),
  INTERSWITCH_MERCHANT_CODE: z.string().min(1),
  INTERSWITCH_PAY_ITEM_ID: z.string().min(1),
  INTERSWITCH_CHECKOUT_SCRIPT_URL: z.string().url(),
  INTERSWITCH_REQUERY_URL: z.string().url(),
  INTERSWITCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  PAYMENT_PENDING_WINDOW_MINUTES: z.coerce.number().int().positive().default(30),
});

function parseEnv() {
  loadDotEnv();
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

function assertSafeForProduction(env) {
  if (env.NODE_ENV !== 'production') return;
  const requeryHost = new URL(env.INTERSWITCH_REQUERY_URL).hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(requeryHost)) {
    throw new Error('INTERSWITCH_REQUERY_URL must not point at a local mock gateway in production');
  }
}

const env = parseEnv();
assertSafeForProduction(env);

export const config = Object.freeze({
  env: env.NODE_ENV,
  port: env.PORT,
  appBaseUrl: env.APP_BASE_URL,
  interswitch: Object.freeze({
    mode: env.INTERSWITCH_MODE,
    merchantCode: env.INTERSWITCH_MERCHANT_CODE,
    payItemId: env.INTERSWITCH_PAY_ITEM_ID,
    checkoutScriptUrl: env.INTERSWITCH_CHECKOUT_SCRIPT_URL,
    requeryUrl: env.INTERSWITCH_REQUERY_URL,
    timeoutMs: env.INTERSWITCH_TIMEOUT_MS,
  }),
  payment: Object.freeze({
    pendingWindowMinutes: env.PAYMENT_PENDING_WINDOW_MINUTES,
  }),
});
