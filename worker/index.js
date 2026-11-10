import { DurableObject } from 'cloudflare:workers';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58E8F';
const POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const usdtAbi = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
]);
const poolAbi = parseAbi([
  'function supplyWithPermit(address asset,uint256 amount,address onBehalfOf,uint16 referralCode,uint256 deadline,uint8 permitV,bytes32 permitR,bytes32 permitS)',
]);
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const isAddress = (v) => /^0x[0-9a-f]{40}$/i.test(v || '');
const isHash = (v) => /^(?:0x)?[0-9a-f]{64}$/i.test(v || '');
const uuid = () => crypto.randomUUID();
function nimiqAddress(value) {
  const compact = String(value || '').replace(/\s/g, '').toUpperCase();
  if (!/^NQ[A-Z0-9]{34}$/.test(compact)) return null;
  return compact.match(/.{1,4}/g).join(' ');
}
function relayerKey(value) {
  const raw = String(value || '').replace(/^0x/i, '');
  return /^[0-9a-f]{64}$/i.test(raw) ? `0x${raw}` : null;
}

function configIssues(env) {
  const isHttpsUrl = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
  return [
    ['RELAYER_PRIVATE_KEY', Boolean(relayerKey(env.RELAYER_PRIVATE_KEY))],
    ['NIM_FEE_ADDRESS', Boolean(nimiqAddress(env.NIM_FEE_ADDRESS))],
    ['NIM_RELAY_FEE_LUNA', /^[1-9]\d{0,8}$/.test(String(env.NIM_RELAY_FEE_LUNA || ''))],
    ['POLYGON_RPC_URL', isHttpsUrl(env.POLYGON_RPC_URL)],
    ['NIMIQ_RPC_URL', isHttpsUrl(env.NIMIQ_RPC_URL)],
    ['RELAY_SUPPORT_URL', isHttpsUrl(env.RELAY_SUPPORT_URL)],
  ].filter(([, valid]) => !valid).map(([name]) => name);
}
function config(env) { return configIssues(env).length === 0; }
function clients(env) {
  const account = privateKeyToAccount(relayerKey(env.RELAYER_PRIVATE_KEY));
  const publicClient = createPublicClient({ chain: polygon, transport: http(env.POLYGON_RPC_URL) });
  const walletClient = createWalletClient({ account, chain: polygon, transport: http(env.POLYGON_RPC_URL) });
  return { account, publicClient, walletClient };
}
async function nimiqRpc(env, method, params) {
  const res = await fetch(env.NIMIQ_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!res.ok) throw new Error('Nimiq RPC unavailable');
  const data = await res.json();
  if (data.error) throw new Error('Nimiq RPC rejected the verification request');
  return data.result?.data;
}

export class RelayJob extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; }
  async fetch(request) {
    if (request.method === 'PUT') {
      const job = await request.json();
      await this.ctx.storage.put('job', job);
      if (job.status === 'submitted' || job.status === 'pending') await this.ctx.storage.setAlarm(Date.now() + 5000);
      return json({ ok: true });
    }
    if (request.method === 'POST') {
      const { paymentHash, finalized } = await request.json();
      const job = await this.ctx.storage.get('job');
      if (!job) return json({ claimed: false, status: 'unknown' }, 404);
      if (!finalized && job.status === 'awaiting_nim') {
        const updated = { ...job, status: 'nim_pending', nimTxHash: paymentHash };
        await this.ctx.storage.put('job', updated);
        return json({ claimed: true, status: updated.status });
      }
      if (!finalized && job.status === 'nim_pending' && job.nimTxHash?.toLowerCase() === paymentHash.toLowerCase()) return json({ claimed: true, status: job.status });
      if (finalized && ['awaiting_nim', 'nim_pending'].includes(job.status) && (job.status === 'awaiting_nim' || job.nimTxHash?.toLowerCase() === paymentHash.toLowerCase())) {
        const updated = { ...job, status: 'relaying', nimTxHash: paymentHash };
        await this.ctx.storage.put('job', updated);
        return json({ claimed: true, status: updated.status });
      }
      return json({ claimed: false, status: job.status });
    }
    if (request.method === 'GET') return json(await this.ctx.storage.get('job') || { status: 'unknown' });
    return json({ error: 'Method not allowed' }, 405);
  }
  async alarm() {
    const job = await this.ctx.storage.get('job');
    if (!job || !['submitted', 'pending'].includes(job.status)) return;
    try {
      const { publicClient } = clients(this.env);
      const receipt = await publicClient.getTransactionReceipt({ hash: job.polygonTxHash });
      const status = receipt.status === 'success' ? 'complete' : 'refund_review';
      await this.ctx.storage.put('job', { ...job, status });
    } catch {
      await this.ctx.storage.put('job', { ...job, status: 'pending' });
      await this.ctx.storage.setAlarm(Date.now() + 15000);
    }
  }
}

export class PaymentClaims extends DurableObject {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const { hash, quoteId } = await request.json();
    const key = `nim:${hash.replace(/^0x/i, '').toLowerCase()}`;
    const existing = await this.ctx.storage.get(key);
    if (existing) return json({ claimed: existing === quoteId });
    await this.ctx.storage.put(key, quoteId);
    return json({ claimed: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/relay/')) return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-origin': url.origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).origin !== url.origin) return json({ error: 'Origin rejected' }, 403);
    if (url.pathname === '/api/relay/status' && request.method === 'GET') {
      const missing = configIssues(env);
      return json({ enabled: missing.length === 0, feeUnit: 'luna', missing });
    }
    if (!config(env)) return json({ error: 'NIM gas relay is not configured yet.' }, 503);

    try {
      if (url.pathname === '/api/relay/quote' && request.method === 'POST') {
        const { owner, amount } = await request.json();
        if (!isAddress(owner) || !/^[1-9]\d{0,11}$/.test(String(amount))) return json({ error: 'Invalid owner or USDT amount.' }, 400);
        const id = uuid();
        const quote = { id, owner, amount: String(amount), fee: String(env.NIM_RELAY_FEE_LUNA), recipient: nimiqAddress(env.NIM_FEE_ADDRESS), supportUrl: env.RELAY_SUPPORT_URL, memo: `current:${id}`, expiresAt: Date.now() + 5 * 60_000, status: 'quoted' };
        await env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(id)).fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(quote) });
        return json(quote);
      }

      if (url.pathname === '/api/relay/prepare' && request.method === 'POST') {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body.quoteId || '') || !isAddress(body.owner) || !/^[1-9]\d{0,11}$/.test(String(body.amount))) return json({ error: 'Invalid relay request.' }, 400);
        const jobStub = env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(body.quoteId));
        const quote = await (await jobStub.fetch('https://relay/job')).json();
        if (quote.status !== 'quoted' || quote.expiresAt < Date.now() || quote.owner.toLowerCase() !== body.owner.toLowerCase() || quote.amount !== String(body.amount)) return json({ error: 'Quote expired or does not match this wallet and amount.' }, 409);
        const { account, publicClient } = clients(env);
        const nonce = await publicClient.readContract({ address: USDT, abi: usdtAbi, functionName: 'nonces', args: [body.owner] });
        if (BigInt(body.permit.nonce) !== nonce || Number(body.permit.deadline) < Math.floor(Date.now() / 1000) || Number(body.permit.deadline) > Math.floor(Date.now() / 1000) + 1300) return json({ error: 'USDT permit is expired or has a different nonce.' }, 400);
        const call = { account, address: POOL, abi: poolAbi, functionName: 'supplyWithPermit', args: [USDT, BigInt(body.amount), body.owner, 0, BigInt(body.permit.deadline), Number(body.permit.v), body.permit.r, body.permit.s] };
        await publicClient.simulateContract(call);
        const [gas, gasPrice, balance] = await Promise.all([
          publicClient.estimateContractGas(call), publicClient.getGasPrice(), publicClient.getBalance({ address: account.address }),
        ]);
        if (balance < gas * gasPrice * 13n / 10n) return json({ error: 'Relayer POL balance is too low to cover this supply. Try the standard POL-paid path or contact support.' }, 503);
        const prepared = { ...quote, status: 'awaiting_nim', permit: body.permit };
        await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(prepared) });
        return json({ ok: true, quoteId: quote.id, fee: quote.fee, recipient: quote.recipient, memo: quote.memo, expiresAt: quote.expiresAt });
      }

      if (url.pathname === '/api/relay/submit' && request.method === 'POST') {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body.quoteId || '') || !isHash(body.nimTxHash || '')) return json({ error: 'Invalid relay submission.' }, 400);
        const id = body.quoteId;
        const jobStub = env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(id));
        const quote = await (await jobStub.fetch('https://relay/job')).json();
        if (!['awaiting_nim', 'nim_pending'].includes(quote.status)) return json({ status: quote.status, polygonTxHash: quote.polygonTxHash || null }, 409);
        const tx = await nimiqRpc(env, 'getTransactionByHash', [body.nimTxHash.replace(/^0x/i, '').toUpperCase()]);
        const data = tx?.recipientData?.replace(/^0x/i, '').toLowerCase();
        const expectedMemo = [...new TextEncoder().encode(quote.memo)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const sameRecipient = String(tx?.to || '').replace(/\s/g, '').toUpperCase() === String(env.NIM_FEE_ADDRESS).replace(/\s/g, '').toUpperCase();
        if (!tx || tx.executionResult !== true || !sameRecipient || String(tx.value) !== quote.fee || data !== expectedMemo || !tx.blockHeight) return json({ error: 'NIM payment is not included or does not match the quoted recipient, amount, and memo.' }, 409);
        if (quote.status === 'awaiting_nim' && quote.expiresAt < Date.now() && Number(tx.timestamp) > quote.expiresAt) return json({ error: 'This quote expired before the NIM payment. Contact support if you already sent funds.' }, 409);
        const paymentLock = await (await jobStub.fetch('https://relay/job', { method: 'POST', body: JSON.stringify({ paymentHash: body.nimTxHash, finalized: false }) })).json();
        if (!paymentLock.claimed) return json({ error: 'A different NIM payment is already linked to this quote.' }, 409);
        const batch = await nimiqRpc(env, 'getBatchAt', [Number(tx.blockHeight)]);
        const macroBlock = await nimiqRpc(env, 'getMacroBlockOf', [batch]);
        const head = await nimiqRpc(env, 'getBlockNumber', []);
        if (!Number.isFinite(Number(macroBlock)) || Number(head) < Number(macroBlock)) {
          const pending = { ...quote, status: 'nim_pending', nimTxHash: body.nimTxHash };
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(pending) });
          return json({ status: 'nim_pending', message: 'NIM payment found. Waiting for Nimiq macro-block finality; do not pay again.' }, 202);
        }
        const lock = await (await jobStub.fetch('https://relay/job', { method: 'POST', body: JSON.stringify({ paymentHash: body.nimTxHash, finalized: true }) })).json();
        if (!lock.claimed) return json({ status: lock.status, message: 'Relay already claimed this quote. Do not pay again.' }, 409);
        const claim = await env.PAYMENT_CLAIMS.get(env.PAYMENT_CLAIMS.idFromName('global')).fetch('https://claims/claim', { method: 'POST', body: JSON.stringify({ hash: body.nimTxHash, quoteId: id }) });
        if (!(await claim.json()).claimed) {
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify({ ...quote, status: 'payment_reused' }) });
          return json({ error: 'This NIM payment was already used for a different quote.' }, 409);
        }
        const paid = { ...quote, status: 'relaying', nimTxHash: body.nimTxHash };
        await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(paid) });
        const { account, publicClient, walletClient } = clients(env);
        try {
          const hash = await walletClient.writeContract({ address: POOL, abi: poolAbi, functionName: 'supplyWithPermit', args: [USDT, BigInt(quote.amount), quote.owner, 0, BigInt(quote.permit.deadline), Number(quote.permit.v), quote.permit.r, quote.permit.s] });
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify({ ...paid, status: 'submitted', polygonTxHash: hash }) });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => null);
          const result = receipt?.status === 'success' ? { ...paid, status: 'complete', polygonTxHash: hash } : receipt?.status === 'reverted' ? { ...paid, status: 'refund_review', polygonTxHash: hash } : { ...paid, status: 'pending', polygonTxHash: hash };
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(result) });
          return json({ status: result.status, polygonTxHash: hash });
        } catch {
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify({ ...paid, status: 'refund_review' }) });
          return json({ status: 'refund_review', message: 'NIM payment verified, but supply did not complete. Contact support for manual review.' }, 502);
        }
      }

      const match = url.pathname.match(/^\/api\/relay\/job\/([0-9a-f-]{36})$/i);
      if (match && request.method === 'GET') {
        const job = await (await env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(match[1])).fetch('https://relay/job')).json();
        return json({ status: job.status || 'unknown', polygonTxHash: job.polygonTxHash || null });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error?.message || 'Relay request failed.' }, 400);
    }
  },
};
