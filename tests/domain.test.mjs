import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AAVE_V3_POLYGON_POOL,
  CHAIN_ID,
  TOKEN_DECIMALS,
  USDT_ADDRESS,
  amountFromInput,
  encodeAllowance,
  encodeBalanceOf,
  estimateSimpleYield,
  expectedBalanceDelta,
  formatTokenAmount,
  parseTokenAmount,
  prepareExactApprovalTransaction,
  validateApprovalTransaction,
  validateSupplyTransaction,
  validateWithdrawTransaction,
} from '../public/domain.mjs';

function pad(value) { return BigInt(value).toString(16).padStart(64, '0'); }
function addressWord(value) { return value.slice(2).toLowerCase().padStart(64, '0'); }
function tx(data, to, from, operation = null) { return { to, from, data, value: '0x0', chainId: CHAIN_ID, operation }; }

test('USDT amount parsing preserves six decimal places and rejects unsafe formats', () => {
  assert.equal(parseTokenAmount('3.45'), 3_450_000n);
  assert.equal(parseTokenAmount('0.000001'), 1n);
  assert.equal(formatTokenAmount(3_450_000n), '3.45');
  for (const value of ['', '0', '-1', '1e3', '1,000', '1.0000001', '.5']) {
    assert.throws(() => parseTokenAmount(value), { name: 'Error' });
  }
});

test('amount ceiling is checked against wallet or supplied position', () => {
  assert.equal(amountFromInput('1', 'supply', 2_000_000n, 0n), 1_000_000n);
  assert.throws(() => amountFromInput('3', 'supply', 2_000_000n, 0n), /wallet balance/);
  assert.throws(() => amountFromInput('1', 'withdraw', 0n, 500_000n), /Aave position/);
});

test('yield lens uses only the current input, live APY percentage and stated simple-interest period', () => {
  assert.equal(estimateSimpleYield(100_000_000n, '5', 30), 410_958n);
  assert.equal(estimateSimpleYield(100_000_000n, '5', 365), 5_000_000n);
  assert.equal(estimateSimpleYield(1_000_000n, '0', 30), 0n);
  assert.throws(() => estimateSimpleYield(1_000_000n, '5.000000001', 30), /valid percentage/);
  assert.throws(() => estimateSimpleYield(1_000_000n, '1e2', 30), /valid percentage/);
  assert.throws(() => estimateSimpleYield(1_000_000n, '5', 0), /valid estimate period/);
});

test('read-only ERC-20 calls encode the exact account and spender', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  assert.equal(encodeBalanceOf(owner), `0x70a08231${addressWord(owner)}`);
  assert.equal(encodeAllowance(owner, AAVE_V3_POLYGON_POOL), `0xdd62ed3e${addressWord(owner)}${addressWord(AAVE_V3_POLYGON_POOL)}`);
  assert.throws(() => encodeBalanceOf('0x1234'), /invalid/);
});

test('approval transaction must be exact, on Polygon and scoped to the verified Aave pool', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const amount = 1_250_000n;
  const data = `0x095ea7b3${addressWord(AAVE_V3_POLYGON_POOL)}${pad(amount)}`;
  assert.equal(validateApprovalTransaction(tx(data, USDT_ADDRESS, owner), owner, amount), true);
  assert.throws(() => validateApprovalTransaction(tx(`0x095ea7b3${addressWord(AAVE_V3_POLYGON_POOL)}${pad(2n ** 256n - 1n)}`, USDT_ADDRESS, owner), owner, amount), /exact USDT amount/);
  assert.throws(() => validateApprovalTransaction({ ...tx(data, USDT_ADDRESS, owner), chainId: 1 }, owner, amount), /exact USDT amount/);
});

test('broader Aave approval plans are narrowed to the exact amount only when current allowance is zero', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const amount = 1_300_000n;
  const broad = tx(`0x095ea7b3${addressWord(AAVE_V3_POLYGON_POOL)}${pad(2n ** 256n - 1n)}`, USDT_ADDRESS, owner);
  const exact = prepareExactApprovalTransaction(broad, owner, amount, 0n);
  assert.equal(validateApprovalTransaction(exact, owner, amount), true);
  assert.equal(exact.data, `0x095ea7b3${addressWord(AAVE_V3_POLYGON_POOL)}${pad(amount)}`);
  assert.throws(() => prepareExactApprovalTransaction(broad, owner, amount, 1n), /broader approval/);
});

test('supply calldata must match wallet, USDT, pool and exact amount', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const amount = 5_000_001n;
  const data = `0x617ba037${addressWord(USDT_ADDRESS)}${pad(amount)}${addressWord(owner)}${pad(0)}`;
  assert.equal(validateSupplyTransaction(tx(data, AAVE_V3_POLYGON_POOL, owner, 'SUPPLY'), owner, amount), true);
  assert.throws(() => validateSupplyTransaction(tx(data, AAVE_V3_POLYGON_POOL, owner, 'WITHDRAW'), owner, amount), /did not match/);
  assert.throws(() => validateSupplyTransaction(tx(data, '0x2222222222222222222222222222222222222222', owner, 'SUPPLY'), owner, amount), /did not match/);
  assert.throws(() => validateSupplyTransaction(tx(data.replace(addressWord(owner), addressWord('0x3333333333333333333333333333333333333333')), AAVE_V3_POLYGON_POOL, owner, 'SUPPLY'), owner, amount), /did not match/);
});

test('withdraw calldata must return to the connected wallet and match exact amount', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const amount = 10_000n;
  const data = `0x69328dec${addressWord(USDT_ADDRESS)}${pad(amount)}${addressWord(owner)}`;
  assert.equal(validateWithdrawTransaction(tx(data, AAVE_V3_POLYGON_POOL, owner, 'WITHDRAW'), owner, amount), true);
  assert.throws(() => validateWithdrawTransaction(tx(data, AAVE_V3_POLYGON_POOL, owner, 'SUPPLY'), owner, amount), /did not match/);
  assert.throws(() => validateWithdrawTransaction(tx(data, AAVE_V3_POLYGON_POOL, '0x2222222222222222222222222222222222222222', 'WITHDRAW'), owner, amount), /did not match/);
});

test('position delta is independently checked before a success state', () => {
  assert.equal(expectedBalanceDelta(2_000_000n, 3_000_001n, 1_000_000n, 'supply'), true);
  assert.equal(expectedBalanceDelta(2_000_000n, 2_900_000n, 1_000_000n, 'supply'), false);
  assert.equal(expectedBalanceDelta(2_000_000n, 1_000_000n, 1_000_000n, 'withdraw'), true);
  assert.equal(expectedBalanceDelta(2_000_000n, 1_500_000n, 1_000_000n, 'withdraw'), false);
  assert.equal(TOKEN_DECIMALS, 6);
});
