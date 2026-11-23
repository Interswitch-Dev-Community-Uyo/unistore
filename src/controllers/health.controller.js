import { prisma } from '../config/database.js';

export async function getHealth(req, res) {
  const checkedAt = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()), checkedAt } });
  } catch {
    res.status(503).json({ data: { status: 'degraded', database: 'down', checkedAt } });
  }
}
