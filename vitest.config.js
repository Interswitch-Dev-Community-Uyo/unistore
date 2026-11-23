import { defineConfig } from 'vitest/config';

export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://unistore:unistore@localhost:5432/unistore_test?schema=public';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  APP_BASE_URL: 'http://localhost:3000',
  INTERSWITCH_MODE: 'TEST',
  INTERSWITCH_MERCHANT_CODE: 'MX6072',
  INTERSWITCH_PAY_ITEM_ID: '9405967',
  INTERSWITCH_CHECKOUT_SCRIPT_URL: 'https://newwebpay-sandbox.interswitchng.com/inline-checkout.js',
  INTERSWITCH_REQUERY_URL: 'https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json',
  INTERSWITCH_TIMEOUT_MS: '200',
  PAYMENT_PENDING_WINDOW_MINUTES: '30',
};

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    fileParallelism: false,
    restoreMocks: true,
    env,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.js'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.js'],
          globalSetup: ['tests/helpers/global-setup.js'],
        },
      },
    ],
  },
});
