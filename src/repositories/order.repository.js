import { prisma } from '../config/database.js';

export function createOrder(data, db = prisma) {
  return db.order.create({ data });
}

export function findOrderById(id, db = prisma) {
  return db.order.findUnique({ where: { id } });
}

export function markOrderPaidIfPending(id, db = prisma) {
  return db.order.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PAID' } });
}
