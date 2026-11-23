import { execSync } from 'node:child_process';
import { testDatabaseUrl } from '../../vitest.config.js';

export default function setup() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'pipe',
  });
}
