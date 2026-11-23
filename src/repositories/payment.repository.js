import { prisma } from '../config/database.js';

export function createPayment(data, db = prisma) {
  return db.payment.create({ data });
}

export function findPaymentByReference(transactionReference, db = prisma) {
  return db.payment.findUnique({ where: { transactionReference }, include: { order: true } });
}

export function findPendingPaymentForOrder(orderId, db = prisma) {
  return db.payment.findFirst({ where: { orderId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
}

export function updatePaymentIfStatus(id, expectedStatus, data, db = prisma) {
  return db.payment.updateMany({ where: { id, status: expectedStatus }, data });
}

export function runInTransaction(work) {
  return prisma.$transaction(work);
}
