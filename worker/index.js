import { DurableObject } from 'cloudflare:workers';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { handlePaymentClaim, handleRelayJobState } from './durable-state.mjs';
import { goalMessage, nimPaymentMatchesQuote, relaySupplyPositionMatches, signatureMatchesOwner } from './relay-logic.mjs';

const TOKENS = Object.freeze({
  usdt: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', aToken: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620', symbol: 'USDT' },
  usdc: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', aToken: '0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD', symbol: 'USDC' },
});
const POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const usdtAbi = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
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
function errorChainText(error) {
  const seen = new Set();
  const messages = [];
  while (error && !seen.has(error)) {
    seen.add(error);
    messages.push(error.shortMessage, error.message, error.details);
    error = error.cause;
  }
  return messages.filter(Boolean).join(' ');
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
  fetch(request) { return handleRelayJobState(this.ctx, request); }
  async alarm() {
    const job = await this.ctx.storage.get('job');
    if (!job || !['submitted', 'pending'].includes(job.status)) return;
    try {
      const { publicClient } = clients(this.env);
      const receipt = await publicClient.getTransactionReceipt({ hash: job.polygonTxHash });
      if (receipt.status === 'reverted') {
        await this.ctx.storage.put('job', { ...job, status: 'refund_review' });
        return;
      }
      const after = await publicClient.readContract({ address: job.aToken, abi: usdtAbi, functionName: 'balanceOf', args: [job.owner] });
      if (relaySupplyPositionMatches({ receipt, hash: job.polygonTxHash, relayer: job.relayer, pool: POOL, before: job.aTokenBefore, after, amount: job.amount })) {
        await this.ctx.storage.put('job', { ...job, status: 'complete' });
        return;
      }
      const attempts = Number(job.verifyAttempts || 0) + 1;
      const status = attempts >= 24 ? 'position_review' : 'pending';
      await this.ctx.storage.put('job', { ...job, status, verifyAttempts: attempts });
      if (status === 'pending') await this.ctx.storage.setAlarm(Date.now() + 15000);
    } catch {
      const attempts = Number(job.verifyAttempts || 0) + 1;
      const status = attempts >= 24 ? 'position_review' : 'pending';
      await this.ctx.storage.put('job', { ...job, status, verifyAttempts: attempts });
      if (status === 'pending') await this.ctx.storage.setAlarm(Date.now() + 15000);
    }
  }
}

export class PaymentClaims extends DurableObject {
  fetch(request) { return handlePaymentClaim(this.ctx, request); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/relay/') && !url.pathname.startsWith('/api/goals/')) return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-origin': url.origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).origin !== url.origin) return json({ error: 'Origin rejected' }, 403);
    if (url.pathname === '/api/relay/status' && request.method === 'GET') {
      const missing = configIssues(env);
      return json({ enabled: missing.length === 0, feeUnit: 'luna', missing });
    }
    if (url.pathname === '/api/goals/nonce' && request.method === 'POST') {
      const { owner } = await request.json();
      if (!isAddress(owner)) return json({ error: 'A valid wallet address is required.' }, 400);
      const stub = env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(`goals:${owner.toLowerCase()}`));
      return stub.fetch('https://goals/nonce', { method: 'POST' });
    }
    if (url.pathname === '/api/goals/access' && request.method === 'POST') {
      const body = await request.json();
      const { owner, nonce, action, asset, targetRaw, date, signature } = body;
      const token = TOKENS[asset];
      if (!isAddress(owner) || !token || !['read', 'save', 'delete'].includes(action) ||
          typeof nonce !== 'string' || typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) {
        return json({ error: 'Invalid savings goal authorization.' }, 400);
      }
      if (action === 'save' && (!/^\d{1,78}$/.test(String(targetRaw)) || BigInt(targetRaw) <= 0n || BigInt(targetRaw) >= 2n ** 256n ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(`${date}T23:59:59Z`)) || new Date(`${date}T23:59:59Z`).toISOString().slice(0, 10) !== date || new Date(`${date}T23:59:59Z`).getTime() <= Date.now())) {
        return json({ error: 'Choose a valid positive goal and a future date.' }, 400);
      }
      const message = goalMessage({ owner, nonce, action, asset, targetRaw: action === 'save' ? String(targetRaw) : '', date: action === 'save' ? date : '' });
      if (!await signatureMatchesOwner(message, signature, owner)) return json({ error: 'Wallet signature could not be verified for this address.' }, 401);
      const stub = env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(`goals:${owner.toLowerCase()}`));
      const goal = { asset, targetRaw: String(targetRaw || ''), date: String(date || '') };
      return stub.fetch('https://goals/access', { method: 'POST', body: JSON.stringify({ nonce, action, goal }) });
    }
    if (!config(env)) return json({ error: 'NIM gas relay is not configured yet.' }, 503);

    try {
      if (url.pathname === '/api/relay/quote' && request.method === 'POST') {
        const { owner, amount, asset: assetId = 'usdt' } = await request.json();
        const asset = TOKENS[assetId];
        if (!asset || !isAddress(owner) || !/^[1-9]\d{0,11}$/.test(String(amount))) return json({ error: 'Invalid owner, asset, or token amount.' }, 400);
        const { publicClient } = clients(env);
        const availableBalance = await publicClient.readContract({ address: asset.address, abi: usdtAbi, functionName: 'balanceOf', args: [owner] });
        if (BigInt(amount) > availableBalance) return json({ error: `The Worker RPC sees less ${asset.symbol} than this supply amount. Refresh your balance and try again. No NIM payment was requested.`, availableBalance: availableBalance.toString() }, 409);
        const id = uuid();
        const quote = { id, owner, asset: assetId, amount: String(amount), fee: String(env.NIM_RELAY_FEE_LUNA), recipient: nimiqAddress(env.NIM_FEE_ADDRESS), supportUrl: env.RELAY_SUPPORT_URL, memo: `current:${id}`, expiresAt: Date.now() + 5 * 60_000, status: 'quoted' };
        await env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(id)).fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(quote) });
        return json(quote);
      }

      if (url.pathname === '/api/relay/prepare' && request.method === 'POST') {
        const body = await request.json();
        const assetId = body.asset || 'usdt';
        const asset = TOKENS[assetId];
        if (!/^[0-9a-f-]{36}$/i.test(body.quoteId || '') || !asset || !isAddress(body.owner) || !/^[1-9]\d{0,11}$/.test(String(body.amount))) return json({ error: 'Invalid relay request.' }, 400);
        const jobStub = env.RELAY_JOBS.get(env.RELAY_JOBS.idFromName(body.quoteId));
        const quote = await (await jobStub.fetch('https://relay/job')).json();
        if (quote.status !== 'quoted' || quote.expiresAt < Date.now() || quote.owner.toLowerCase() !== body.owner.toLowerCase() || quote.amount !== String(body.amount) || (quote.asset || 'usdt') !== assetId) return json({ error: 'Quote expired or does not match this wallet, asset, and amount.' }, 409);
        const { account, publicClient } = clients(env);
        const availableBalance = await publicClient.readContract({ address: asset.address, abi: usdtAbi, functionName: 'balanceOf', args: [body.owner] });
        if (BigInt(body.amount) > availableBalance) return json({ error: `Your ${asset.symbol} balance changed or the Worker RPC sees less than the requested amount. Refresh your balance and try again. No NIM payment was requested.`, availableBalance: availableBalance.toString() }, 409);
        const nonce = await publicClient.readContract({ address: asset.address, abi: usdtAbi, functionName: 'nonces', args: [body.owner] });
        if (BigInt(body.permit.nonce) !== nonce || Number(body.permit.deadline) < Math.floor(Date.now() / 1000) || Number(body.permit.deadline) > Math.floor(Date.now() / 1000) + 1300) return json({ error: `${asset.symbol} permit is expired or has a different nonce.` }, 400);
        const call = { account, address: POOL, abi: poolAbi, functionName: 'supplyWithPermit', args: [asset.address, BigInt(body.amount), body.owner, 0, BigInt(body.permit.deadline), Number(body.permit.v), body.permit.r, body.permit.s] };
        try { await publicClient.simulateContract(call); }
        catch (error) {
          if (/transfer amount exceeds balance/i.test(errorChainText(error))) {
            const currentBalance = await publicClient.readContract({ address: asset.address, abi: usdtAbi, functionName: 'balanceOf', args: [body.owner] });
            return json({ error: `The Worker RPC cannot confirm enough ${asset.symbol} for this supply. Refresh your balance and try again. No NIM payment was requested.`, availableBalance: currentBalance.toString() }, 409);
          }
          throw error;
        }
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
        if (!nimPaymentMatchesQuote(tx, quote, env.NIM_FEE_ADDRESS)) return json({ error: 'NIM payment is not included or does not match the quoted recipient, amount, memo, execution result, or quote expiry.' }, 409);
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
        const { account, publicClient, walletClient } = clients(env);
        const asset = TOKENS[quote.asset || 'usdt'];
        if (!asset) return json({ status: 'refund_review', message: 'NIM payment verified, but the quoted token is unsupported. Contact support for manual review.' }, 409);
        let aTokenBefore;
        try {
          aTokenBefore = await publicClient.readContract({ address: asset.aToken, abi: usdtAbi, functionName: 'balanceOf', args: [quote.owner] });
        } catch {
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify({ ...quote, status: 'refund_review', nimTxHash: body.nimTxHash }) });
          return json({ status: 'refund_review', message: 'NIM payment verified, but the starting Aave position could not be read. Contact support for manual review.' }, 503);
        }
        const paid = { ...quote, status: 'relaying', nimTxHash: body.nimTxHash, aToken: asset.aToken, aTokenBefore: aTokenBefore.toString(), amount: quote.amount, relayer: account.address, verifyAttempts: 0 };
        await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(paid) });
        try {
          const hash = await walletClient.writeContract({ address: POOL, abi: poolAbi, functionName: 'supplyWithPermit', args: [asset.address, BigInt(quote.amount), quote.owner, 0, BigInt(quote.permit.deadline), Number(quote.permit.v), quote.permit.r, quote.permit.s] });
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify({ ...paid, status: 'submitted', polygonTxHash: hash }) });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => null);
          let verified = false;
          if (receipt?.status === 'success') {
            try {
              const after = await publicClient.readContract({ address: asset.aToken, abi: usdtAbi, functionName: 'balanceOf', args: [quote.owner] });
              verified = relaySupplyPositionMatches({ receipt, hash, relayer: account.address, pool: POOL, before: aTokenBefore, after, amount: quote.amount });
            } catch { /* Leave the job pending for the Durable Object verifier. */ }
          }
          const result = receipt?.status === 'reverted'
            ? { ...paid, status: 'refund_review', polygonTxHash: hash }
            : verified
              ? { ...paid, status: 'complete', polygonTxHash: hash }
              : { ...paid, status: 'pending', polygonTxHash: hash, verifyAttempts: 0 };
          await jobStub.fetch('https://relay/job', { method: 'PUT', body: JSON.stringify(result) });
          return json({ status: result.status, polygonTxHash: hash, message: result.status === 'complete' ? undefined : result.status === 'pending' ? 'Polygon receipt found. Waiting to verify the resulting Aave position; do not pay again.' : undefined });
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
