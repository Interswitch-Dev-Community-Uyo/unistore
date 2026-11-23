import { prisma } from '../../src/config/database.js';

export { prisma };

export async function resetDatabase() {
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
}
