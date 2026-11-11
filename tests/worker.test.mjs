import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { handlePaymentClaim, handleRelayJobState } from '../worker/durable-state.mjs';
import { goalMessage, nimPaymentMatchesQuote, relaySupplyPositionMatches, signatureMatchesOwner } from '../worker/relay-logic.mjs';

const HASH = `0x${'ab'.repeat(32)}`;
const POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const RELAYER = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const QUOTE = '11111111-2222-4333-8444-555555555555';

class MemoryStorage {
  values = new Map();
  alarm = null;
  tail = Promise.resolve();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(time) { this.alarm = time; }
  transaction(callback) {
    const operation = this.tail.then(() => callback({
      get: (key) => this.get(key),
      put: (key, value) => this.put(key, value),
      delete: (key) => this.delete(key),
    }));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function context() { return { storage: new MemoryStorage() }; }
function request(path, method, body) {
  return new Request(`https://worker.test${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? undefined : { 'content-type': 'application/json' } });
}

test('relay payment lifecycle advances once from quote through Nimiq finality to relaying', async () => {
  const ctx = context();
  const put = await handleRelayJobState(ctx, request('/relay/job', 'PUT', { id: QUOTE, status: 'awaiting_nim' }));
  assert.equal(put.status, 200);
  const pending = await handleRelayJobState(ctx, request('/relay/job', 'POST', { paymentHash: HASH, finalized: false }));
  assert.deepEqual(await pending.json(), { claimed: true, status: 'nim_pending' });
  const finalized = await handleRelayJobState(ctx, request('/relay/job', 'POST', { paymentHash: HASH, finalized: true }));
  assert.deepEqual(await finalized.json(), { claimed: true, status: 'relaying' });
  const replay = await handleRelayJobState(ctx, request('/relay/job', 'POST', { paymentHash: HASH, finalized: true }));
  assert.deepEqual(await replay.json(), { claimed: false, status: 'relaying' });
});

test('Nimiq payment verification binds execution, recipient, amount, memo, block inclusion, and expiry', () => {
  const now = 1_800_000_000_000;
  const quote = { fee: '5000', memo: 'current:quote', expiresAt: now - 1000 };
  const recipient = 'NQ92 YHXJ 3UB1 S3X6 J11T 4KDC R5P5 P9X2 9JN2';
  const recipientData = [...new TextEncoder().encode(quote.memo)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const tx = { executionResult: true, to: recipient.replaceAll(' ', ''), value: '5000', recipientData, blockHeight: 42, timestamp: Math.floor((now - 2000) / 1000) };
  assert.equal(nimPaymentMatchesQuote(tx, quote, recipient, now), true);
  assert.equal(nimPaymentMatchesQuote({ ...tx, value: '5001' }, quote, recipient, now), false);
  assert.equal(nimPaymentMatchesQuote({ ...tx, to: 'NQ00' }, quote, recipient, now), false);
  assert.equal(nimPaymentMatchesQuote({ ...tx, recipientData: '00' }, quote, recipient, now), false);
  assert.equal(nimPaymentMatchesQuote({ ...tx, executionResult: false }, quote, recipient, now), false);
  assert.equal(nimPaymentMatchesQuote({ ...tx, timestamp: Math.floor((now + 1000) / 1000) }, quote, recipient, now), false);
});

test('payment-hash replay claims are atomic across quotes and normalize hash case/prefix', async () => {
  const ctx = context();
  const [first, competing] = await Promise.all([
    handlePaymentClaim(ctx, request('/claim', 'POST', { hash: HASH, quoteId: QUOTE })),
    handlePaymentClaim(ctx, request('/claim', 'POST', { hash: HASH.toUpperCase().slice(2), quoteId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })),
  ]);
  const outcomes = [await first.json(), await competing.json()].map((body) => body.claimed).sort();
  assert.deepEqual(outcomes, [false, true]);
  const sameQuote = await handlePaymentClaim(ctx, request('/claim', 'POST', { hash: HASH.toUpperCase(), quoteId: QUOTE }));
  assert.deepEqual(await sameQuote.json(), { claimed: true });
});

test('relay completion requires a matching successful Pool receipt and aToken increase', () => {
  const before = 10_000_000n;
  const amount = 1_000_000n;
  const receipt = { status: 'success', transactionHash: HASH, from: RELAYER, to: POOL };
  const valid = { receipt, hash: HASH, relayer: RELAYER, pool: POOL, before, after: before + amount, amount };
  assert.equal(relaySupplyPositionMatches(valid), true);
  assert.equal(relaySupplyPositionMatches({ ...valid, after: before }), false);
  assert.equal(relaySupplyPositionMatches({ ...valid, receipt: { ...receipt, status: 'reverted' } }), false);
  assert.equal(relaySupplyPositionMatches({ ...valid, receipt: { ...receipt, to: OWNER } }), false);
  assert.equal(relaySupplyPositionMatches({ ...valid, receipt: { ...receipt, transactionHash: `0x${'cd'.repeat(32)}` } }), false);
});

test('goal authorization verifies the signed wallet and consumes a one-time nonce', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const owner = account.address;
  const ctx = context();
  const nonceResponse = await handleRelayJobState(ctx, request('/goals/nonce', 'POST', {}));
  const { nonce } = await nonceResponse.json();
  const goal = { asset: 'usdt', targetRaw: '125000000', date: '2027-12-31' };
  const message = goalMessage({ owner, nonce, action: 'save', ...goal });
  const signature = await account.signMessage({ message });
  assert.equal(await signatureMatchesOwner(message, signature, owner), true);
  assert.equal(await signatureMatchesOwner(message, signature, OWNER), false);
  assert.equal(await signatureMatchesOwner(`${message} altered`, signature, owner), false);
  const payload = { nonce, action: 'save', goal };
  const saved = await handleRelayJobState(ctx, request('/goals/access', 'POST', payload));
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).goal, goal);
  const replayed = await handleRelayJobState(ctx, request('/goals/access', 'POST', payload));
  assert.equal(replayed.status, 409);
});
