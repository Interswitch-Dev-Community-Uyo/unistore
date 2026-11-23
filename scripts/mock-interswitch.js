import { createServer } from 'node:http';

const port = Number(process.env.MOCK_GATEWAY_PORT ?? 4010);
const scenarios = ['approved', 'declined', 'pending', 'not-found', 'amount-mismatch', 'timeout', 'server-error'];
let scenario = process.env.MOCK_SCENARIO ?? 'approved';

function transactionBody(query, overrides) {
  return {
    Amount: Number(query.get('amount')),
    CardNumber: '',
    MerchantReference: query.get('transactionreference'),
    PaymentReference: `MOCK|WEB|${query.get('merchantcode')}|${Date.now()}`,
    RetrievalReferenceNumber: '000000000000',
    SplitAccounts: [],
    TransactionDate: new Date().toISOString().slice(0, 19),
    AccountNumber: '',
    ...overrides,
  };
}

const responders = {
  approved: (query) => [200, transactionBody(query, { ResponseCode: '00', ResponseDescription: 'Approved by Financial Institution' })],
  declined: (query) => [200, transactionBody(query, { ResponseCode: '51', ResponseDescription: 'Insufficient Funds' })],
  pending: (query) => [200, transactionBody(query, { ResponseCode: '09', ResponseDescription: 'Transaction In Progress' })],
  'not-found': () => [200, { ResponseCode: 'Z25', ResponseDescription: 'Transaction not Found', Amount: 0, SplitAccounts: [] }],
  'amount-mismatch': (query) =>
    [200, transactionBody(query, { Amount: 100, ResponseCode: '00', ResponseDescription: 'Approved by Financial Institution' })],
  'server-error': () => [500, { message: 'Mock gateway failure' }],
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === 'POST' && url.pathname === '/__scenario') {
    const next = url.searchParams.get('name');
    if (!scenarios.includes(next)) return send(res, 400, { error: `Unknown scenario. Use one of: ${scenarios.join(', ')}` });
    scenario = next;
    console.log(`[mock-interswitch] scenario -> ${scenario}`);
    return send(res, 200, { scenario });
  }

  if (req.method !== 'GET' || !url.pathname.endsWith('/gettransaction.json')) {
    return send(res, 404, { error: 'Not found' });
  }

  console.log(`[mock-interswitch] requery ${url.searchParams.get('transactionreference')} -> ${scenario}`);
  if (scenario === 'timeout') return undefined;

  const [status, body] = responders[scenario](url.searchParams);
  return send(res, status, body);
});

server.listen(port, () => {
  console.log('[mock-interswitch] LOCAL TEST DOUBLE. No real payment is processed or verified.');
  console.log(`[mock-interswitch] requery URL: http://localhost:${port}/collections/api/v1/gettransaction.json`);
  console.log(`[mock-interswitch] scenario: ${scenario} (change with POST /__scenario?name=<${scenarios.join('|')}>)`);
});
