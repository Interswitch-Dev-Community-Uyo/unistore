import * as paymentService from '../services/payment.service.js';

export async function initializePayment(req, res) {
  const result = await paymentService.initializePayment(req.validated.body.orderId);
  res.status(201).json({ data: result });
}

export async function verifyPayment(req, res) {
  const result = await paymentService.verifyPayment(req.validated.body.transactionReference);
  res.json({ data: result });
}

export async function getPayment(req, res) {
  const payment = await paymentService.getPayment(req.validated.params.reference);
  res.json({ data: payment });
}
