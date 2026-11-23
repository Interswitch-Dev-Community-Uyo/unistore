import { maskEmail } from './logger.js';

export function presentProduct(product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceMinor: product.priceMinor,
    currency: product.currency,
  };
}

export function presentOrder(order) {
  return {
    id: order.id,
    customerEmail: order.customerEmail,
    productId: order.productId,
    amountMinor: order.amountMinor,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function presentPayment(payment, order) {
  return {
    transactionReference: payment.transactionReference,
    status: payment.status,
    isFinal: payment.status !== 'PENDING',
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    gatewayResponseCode: payment.gatewayResponseCode,
    gatewayResponseDescription: payment.gatewayResponseDescription,
    gatewayPaymentReference: payment.gatewayPaymentReference,
    verifiedAt: payment.verifiedAt,
    createdAt: payment.createdAt,
    order: {
      id: order.id,
      status: order.status,
      customerEmail: maskEmail(order.customerEmail),
      amountMinor: order.amountMinor,
      currency: order.currency,
    },
  };
}
