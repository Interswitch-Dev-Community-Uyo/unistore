import * as orderService from '../services/order.service.js';

export function listProducts(req, res) {
  res.json({ data: orderService.getProducts() });
}

export async function createOrder(req, res) {
  const order = await orderService.createOrder(req.validated.body);
  res.status(201).json({ data: order });
}

export async function getOrder(req, res) {
  const order = await orderService.getOrder(req.validated.params.orderId);
  res.json({ data: order });
}
