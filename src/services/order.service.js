import { findProduct, listProducts } from '../config/products.js';
import * as orderRepository from '../repositories/order.repository.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { presentOrder, presentProduct } from '../utils/presenters.js';

export function getProducts() {
  return listProducts().map(presentProduct);
}

export async function createOrder({ customerEmail, productId }) {
  const product = findProduct(productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product '${productId}' does not exist`);

  const order = await orderRepository.createOrder({
    customerEmail,
    productId: product.id,
    amountMinor: product.priceMinor,
    currency: product.currency,
  });

  logger.info('order.created', { orderId: order.id, amountMinor: order.amountMinor });
  return presentOrder(order);
}

export async function getOrder(orderId) {
  const order = await orderRepository.findOrderById(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  return presentOrder(order);
}
