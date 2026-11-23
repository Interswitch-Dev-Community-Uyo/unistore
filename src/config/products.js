export const NAIRA_CURRENCY_CODE = '566';

const products = Object.freeze([
  Object.freeze({
    id: 'unistore-hoodie',
    name: 'UniStore Campus Hoodie',
    description: 'A warm hoodie for late-night lab sessions.',
    priceMinor: 10000,
    currency: NAIRA_CURRENCY_CODE,
  }),
]);

export function listProducts() {
  return products;
}

export function findProduct(productId) {
  return products.find((product) => product.id === productId) ?? null;
}
