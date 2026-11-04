export const CHAIN_ID = 137;
export const POLYGON_HEX_CHAIN_ID = '0x89';
export const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
export const AAVE_V3_POLYGON_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
export const AAVE_V3_POLYGON_ATOKEN = '0x6ab707Aca953eDAeFBc4fD23bA73294241490620';
export const TOKEN_DECIMALS = 6;
export const AAVE_GRAPHQL = 'https://api.v3.aave.com/graphql';

export function parseTokenAmount(input, decimals = TOKEN_DECIMALS) {
  const value = String(input).trim();
  if (!/^\d+(?:\.\d*)?$/.test(value)) throw new Error('Enter a positive amount using digits and a decimal point.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  const units = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (units <= 0n) throw new Error('Enter an amount greater than zero.');
  return units;
}

export function formatTokenAmount(raw, decimals = TOKEN_DECIMALS, maxFraction = 6) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return fraction ? `${whole.toLocaleString('en-US')}.${fraction}` : whole.toLocaleString('en-US');
}

export function isAddress(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function encodeBalanceOf(address) {
  if (!isAddress(address)) throw new Error('Wallet address is invalid.');
  return `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

export function encodeAllowance(owner, spender) {
  if (!isAddress(owner) || !isAddress(spender)) throw new Error('Wallet or protocol address is invalid.');
  return `0xdd62ed3e${owner.slice(2).toLowerCase().padStart(64, '0')}${spender.slice(2).toLowerCase().padStart(64, '0')}`;
}

function txBaseIsValid(tx, from) {
  return tx && isAddress(tx.to) && isAddress(tx.from) &&
    tx.from.toLowerCase() === from.toLowerCase() &&
    Number(tx.chainId) === CHAIN_ID &&
    /^0x[0-9a-fA-F]*$/.test(tx.data || '') &&
    BigInt(tx.value ?? '0x0') === 0n;
}

function word(data, index) {
  const start = 10 + index * 64;
  const part = data.slice(start, start + 64);
  if (part.length !== 64) throw new Error('Transaction data is incomplete.');
  return part.toLowerCase();
}

function addressWord(data, index) {
  return `0x${word(data, index).slice(24)}`;
}

export function validateApprovalTransaction(tx, from, amountRaw) {
  if (!txBaseIsValid(tx, from) || tx.to.toLowerCase() !== USDT_ADDRESS.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x095ea7b3' ||
      addressWord(tx.data, 0) !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw)) {
    throw new Error('The Aave approval details did not match the exact USDT amount and official Polygon market. Nothing was sent.');
  }
  return true;
}

export function prepareExactApprovalTransaction(tx, from, amountRaw, currentAllowanceRaw = 0n) {
  if (!txBaseIsValid(tx, from) || tx.to.toLowerCase() !== USDT_ADDRESS.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x095ea7b3' ||
      addressWord(tx.data, 0) !== AAVE_V3_POLYGON_POOL.toLowerCase()) {
    throw new Error('The Aave approval sender, token, spender or Polygon network did not match. Nothing was sent.');
  }

  const requested = BigInt(amountRaw);
  const apiAllowance = BigInt(`0x${word(tx.data, 1)}`);
  if (apiAllowance < requested) {
    throw new Error('The Aave approval plan was below the requested USDT amount. Nothing was sent.');
  }
  if (apiAllowance === requested) return tx;
  if (BigInt(currentAllowanceRaw) !== 0n) {
    throw new Error('Aave requested a broader approval while this wallet already has an allowance. Refresh the wallet before trying again. Nothing was sent.');
  }

  // Keep Aave's verified sender, token, spender, chain and zero value, but narrow
  // a broader API allowance to the exact amount when the on-chain allowance is zero.
  const exactData = `0x095ea7b3${AAVE_V3_POLYGON_POOL.slice(2).toLowerCase().padStart(64, '0')}${requested.toString(16).padStart(64, '0')}`;
  const exactTransaction = { ...tx, data: exactData };
  validateApprovalTransaction(exactTransaction, from, requested);
  return exactTransaction;
}

export function validateSupplyTransaction(tx, from, amountRaw) {
  if (!txBaseIsValid(tx, from) || tx.operation !== 'SUPPLY' || tx.to.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x617ba037' ||
      addressWord(tx.data, 0) !== USDT_ADDRESS.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw) ||
      addressWord(tx.data, 2) !== from.toLowerCase()) {
    throw new Error('The Aave supply details did not match your wallet, USDT, market and exact amount. Nothing was sent.');
  }
  return true;
}

export function validateWithdrawTransaction(tx, from, amountRaw) {
  if (!txBaseIsValid(tx, from) || tx.operation !== 'WITHDRAW' || tx.to.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x69328dec' ||
      addressWord(tx.data, 0) !== USDT_ADDRESS.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw) ||
      addressWord(tx.data, 2) !== from.toLowerCase()) {
    throw new Error('The Aave withdrawal details did not match your wallet, USDT, market and exact amount. Nothing was sent.');
  }
  return true;
}

export function amountFromInput(input, mode, walletBalance, positionBalance) {
  const amount = parseTokenAmount(input);
  const ceiling = mode === 'supply' ? BigInt(walletBalance ?? 0) : BigInt(positionBalance ?? 0);
  if (amount > ceiling) throw new Error(mode === 'supply' ? 'That is more than your USDT wallet balance.' : 'That is more than your Aave position.');
  return amount;
}

export function estimateSimpleYield(principalRaw, apyPercent, days) {
  const rate = String(apyPercent).trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(rate)) throw new Error('Live APY is not a valid percentage.');
  const period = Number(days);
  if (!Number.isInteger(period) || period < 1 || period > 3650) throw new Error('Choose a valid estimate period.');
  const [whole, fraction = ''] = rate.split('.');
  const rateScale = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
  return BigInt(principalRaw) * rateScale * BigInt(period) / (100n * 100_000_000n * 365n);
}

export function expectedBalanceDelta(before, after, amount, mode, tolerance = 2n) {
  const start = BigInt(before);
  const end = BigInt(after);
  const value = BigInt(amount);
  if (mode === 'supply') return end + tolerance >= start + value;
  return end <= start - value + tolerance;
}
