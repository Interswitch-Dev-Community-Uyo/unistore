import { createApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './config/database.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server.started', {
    url: `http://localhost:${config.port}`,
    env: config.env,
    interswitchMode: config.interswitch.mode,
  });
});

async function shutdown(signal) {
  logger.info('server.stopping', { signal });
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
