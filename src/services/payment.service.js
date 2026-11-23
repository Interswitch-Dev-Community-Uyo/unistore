import { config } from '../config/env.js';
import { findProduct } from '../config/products.js';
import { buildInlineCheckoutConfig } from '../integrations/interswitch/checkout-config.js';
import { GatewayUnavailableError } from '../integrations/interswitch/errors.js';
import { requeryTransaction } from '../integrations/interswitch/requery-client.js';
import { interpretRequeryResponse } from '../integrations/interswitch/transaction-interpreter.js';
import * as orderRepository from '../repositories/order.repository.js';
import * as paymentRepository from '../repositories/payment.repository.js';
import { AppError, isUniqueConstraintViolation } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { presentPayment } from '../utils/presenters.js';
import { generateTransactionReference } from '../utils/transaction-reference.js';

const pendingWindowMs = () => config.payment.pendingWindowMinutes * 60_000;

function assertOrderPayable(order) {
  if (order.status === 'PAID') {
    throw new AppError(409, 'ORDER_ALREADY_PAID', 'This order has already been paid for');
  }
  if (order.status !== 'PENDING') {
    throw new AppError(409, 'ORDER_NOT_PAYABLE', `Orders with status ${order.status} cannot be paid for`);
  }
}

function isStale(payment) {
  return Date.now() - payment.createdAt.getTime() > pendingWindowMs();
}

function canStillChange(payment) {
  if (payment.status === 'PENDING') return true;
  return payment.status === 'FAILED' && !isStale(payment);
}

function isAllowedTransition(from, to) {
  if (from === 'PENDING') return true;
  return from === 'FAILED' && to === 'SUCCESSFUL';
}

async function createPendingPayment(order) {
  try {
    const payment = await paymentRepository.createPayment({
      orderId: order.id,
      transactionReference: generateTransactionReference(),
      amountMinor: order.amountMinor,
      currency: order.currency,
    });
    logger.info('payment.initialized', { orderId: order.id, transactionReference: payment.transactionReference });
    return payment;
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const concurrent = await paymentRepository.findPendingPaymentForOrder(order.id);
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function resolveStalePayment(payment) {
  const result = await verifyPayment(payment.transactionReference);
  if (result.status === 'SUCCESSFUL') {
    throw new AppError(409, 'ORDER_ALREADY_PAID', 'This order has already been paid for');
  }
  if (result.status === 'PENDING') {
    throw new AppError(
      409,
      'PAYMENT_UNRESOLVED',
      'A previous payment attempt for this order is still unresolved. Verify it before starting a new one.',
      { transactionReference: payment.transactionReference },
    );
  }
}

async function obtainPendingPayment(order) {
  const existing = await paymentRepository.findPendingPaymentForOrder(order.id);
  if (existing && !isStale(existing)) return existing;
  if (existing) await resolveStalePayment(existing);
  return createPendingPayment(order);
}

export async function initializePayment(orderId) {
  const order = await orderRepository.findOrderById(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  assertOrderPayable(order);

  const payment = await obtainPendingPayment(order);
  const product = findProduct(order.productId) ?? { name: 'UniStore order' };

  return {
    payment: presentPayment(payment, order),
    checkout: buildInlineCheckoutConfig({ order, payment, product }),
  };
}

async function requeryGateway(payment) {
  try {
    const response = await requeryTransaction({
      transactionReference: payment.transactionReference,
      amountMinor: payment.amountMinor,
    });
    return interpretRequeryResponse(response, {
      transactionReference: payment.transactionReference,
      amountMinor: payment.amountMinor,
      initiatedAt: payment.createdAt,
      pendingWindowMinutes: config.payment.pendingWindowMinutes,
    });
  } catch (error) {
    if (!(error instanceof GatewayUnavailableError)) throw error;
    logger.warn('payment.requery_unavailable', {
      transactionReference: payment.transactionReference,
      reason: error.reason,
    });
    return null;
  }
}

function truncate(value, maxLength) {
  return value === null ? null : value.slice(0, maxLength);
}

function buildPaymentUpdate(outcome) {
  const gatewayFields = {
    gatewayResponseCode: truncate(outcome.responseCode, 16),
    gatewayResponseDescription: truncate(outcome.responseDescription, 255),
    gatewayPaymentReference: truncate(outcome.paymentReference, 128),
  };
  if (outcome.status === 'PENDING') return gatewayFields;
  return { ...gatewayFields, status: outcome.status, verifiedAt: new Date() };
}

async function markOrderPaid(payment, tx) {
  const { count } = await orderRepository.markOrderPaidIfPending(payment.orderId, tx);
  if (count !== 1) {
    logger.error('payment.successful_for_unpayable_order', {
      orderId: payment.orderId,
      transactionReference: payment.transactionReference,
    });
  }
}

function logOutcome(payment, outcome) {
  const fields = {
    transactionReference: payment.transactionReference,
    status: outcome.status,
    reason: outcome.reason,
    responseCode: outcome.responseCode,
  };
  if (outcome.reason === 'AMOUNT_MISMATCH' || outcome.reason === 'REFERENCE_MISMATCH') {
    logger.warn('payment.verification_mismatch', { ...fields, expectedAmountMinor: payment.amountMinor });
  } else {
    logger.info('payment.verification_result', fields);
  }
}

async function applyOutcome(payment, outcome) {
  logOutcome(payment, outcome);
  return paymentRepository.runInTransaction(async (tx) => {
    const { count } = await paymentRepository.updatePaymentIfStatus(
      payment.id,
      payment.status,
      buildPaymentUpdate(outcome),
      tx,
    );
    if (count === 1 && outcome.status === 'SUCCESSFUL') await markOrderPaid(payment, tx);
    const current = await paymentRepository.findPaymentByReference(payment.transactionReference, tx);
    return { payment: current, applied: count === 1 };
  });
}

function presentVerification(payment, reason) {
  return { ...presentPayment(payment, payment.order), verification: { reason } };
}

export async function verifyPayment(transactionReference) {
  const payment = await paymentRepository.findPaymentByReference(transactionReference);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'No payment exists with this transaction reference');

  if (!canStillChange(payment)) return presentVerification(payment, 'ALREADY_FINAL');

  const outcome = await requeryGateway(payment);
  if (!outcome) return presentVerification(payment, 'GATEWAY_UNAVAILABLE');
  if (!isAllowedTransition(payment.status, outcome.status)) return presentVerification(payment, 'ALREADY_FINAL');

  const { payment: current, applied } = await applyOutcome(payment, outcome);
  return presentVerification(current, applied ? outcome.reason : 'ALREADY_FINAL');
}

export async function getPayment(transactionReference) {
  const payment = await paymentRepository.findPaymentByReference(transactionReference);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'No payment exists with this transaction reference');
  return presentPayment(payment, payment.order);
}
