import { config } from '../../config/env.js';

export function buildInlineCheckoutConfig({ order, payment, product }) {
  return {
    scriptUrl: config.interswitch.checkoutScriptUrl,
    request: {
      merchant_code: config.interswitch.merchantCode,
      pay_item_id: config.interswitch.payItemId,
      pay_item_name: product.name,
      txn_ref: payment.transactionReference,
      amount: payment.amountMinor,
      currency: Number(payment.currency),
      cust_email: order.customerEmail,
      site_redirect_url: config.appBaseUrl,
      mode: config.interswitch.mode,
    },
  };
}
