const elements = {
  productName: document.querySelector('#product-name'),
  productDescription: document.querySelector('#product-description'),
  productPrice: document.querySelector('#product-price'),
  form: document.querySelector('#checkout-form'),
  email: document.querySelector('#email'),
  payButton: document.querySelector('#pay-button'),
  status: document.querySelector('#status'),
  statusTitle: document.querySelector('#status-title'),
  statusDetail: document.querySelector('#status-detail'),
  statusReference: document.querySelector('#status-reference'),
  recheckButton: document.querySelector('#recheck-button'),
};

const state = { product: null, order: null, transactionReference: null };
const loadedScripts = new Map();

const formatNaira = (amountMinor) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amountMinor / 100);

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message ?? `Request failed with status ${response.status}`);
  return payload.data;
}

function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
          loadedScripts.delete(src);
          reject(new Error('Could not load InterSwitch checkout script'));
        };
        document.head.append(script);
      }),
    );
  }
  return loadedScripts.get(src);
}

function showStatus(kind, title, detail = '', { canRecheck = false } = {}) {
  elements.status.hidden = false;
  elements.status.dataset.kind = kind;
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
  elements.statusReference.textContent = state.transactionReference ? `Reference: ${state.transactionReference}` : '';
  elements.recheckButton.hidden = !canRecheck;
}

function renderPayment(payment) {
  const description = payment.gatewayResponseDescription ?? '';
  if (payment.status === 'SUCCESSFUL') {
    showStatus('success', 'Payment successful. Your order is paid.', description);
  } else if (payment.status === 'FAILED') {
    showStatus('failed', 'Payment failed.', [description, 'You can try again.'].filter(Boolean).join('. '));
  } else {
    showStatus('pending', 'Payment pending.', 'The server has not confirmed this payment yet.', { canRecheck: true });
  }
  elements.payButton.disabled = payment.status === 'SUCCESSFUL';
}

async function verifyPayment() {
  showStatus('pending', 'Verifying payment with the server…');
  try {
    const payment = await api('/api/payments/verify', {
      method: 'POST',
      body: { transactionReference: state.transactionReference },
    });
    renderPayment(payment);
  } catch (error) {
    showStatus('pending', 'Could not verify payment yet.', error.message, { canRecheck: true });
  }
}

async function obtainOrder(customerEmail) {
  if (state.order?.customerEmail === customerEmail && state.order.status === 'PENDING') return state.order;
  state.order = await api('/api/orders', { method: 'POST', body: { customerEmail, productId: state.product.id } });
  return state.order;
}

async function startPayment(event) {
  event.preventDefault();
  elements.payButton.disabled = true;
  try {
    const order = await obtainOrder(elements.email.value.trim().toLowerCase());
    const { payment, checkout } = await api('/api/payments/initialize', {
      method: 'POST',
      body: { orderId: order.id },
    });
    state.transactionReference = payment.transactionReference;
    showStatus('pending', 'Opening InterSwitch checkout…');

    await loadScript(checkout.scriptUrl);
    window.webpayCheckout({ ...checkout.request, onComplete: verifyPayment });
  } catch (error) {
    showStatus('failed', 'Could not start payment.', error.message);
  } finally {
    elements.payButton.disabled = false;
  }
}

async function loadProduct() {
  try {
    const [product] = await api('/api/products');
    state.product = product;
    elements.productName.textContent = product.name;
    elements.productDescription.textContent = product.description;
    elements.productPrice.textContent = formatNaira(product.priceMinor);
    elements.payButton.disabled = false;
  } catch (error) {
    elements.productName.textContent = 'Store unavailable';
    elements.productDescription.textContent = error.message;
  }
}

elements.form.addEventListener('submit', startPayment);
elements.recheckButton.addEventListener('click', verifyPayment);
loadProduct();
