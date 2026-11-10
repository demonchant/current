export const CHAIN_ID = 137;
export const POLYGON_HEX_CHAIN_ID = '0x89';
export const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
export const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
export const AAVE_V3_POLYGON_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
export const AAVE_V3_POLYGON_ATOKEN = '0x6ab707Aca953eDAeFBc4fD23bA73294241490620';
export const AAVE_V3_POLYGON_AUSDC = '0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD';
export const TOKEN_DECIMALS = 6;
export const AAVE_GRAPHQL = 'https://api.v3.aave.com/graphql';

export const ASSETS = Object.freeze({
  usdt: Object.freeze({ id: 'usdt', symbol: 'USDT', marketSymbol: 'USDT0', address: USDT_ADDRESS, aToken: AAVE_V3_POLYGON_ATOKEN, aTokenSymbol: 'aUSDT', decimals: 6, permitDomain: 'salt', permitVersion: '1' }),
  usdc: Object.freeze({ id: 'usdc', symbol: 'USDC', marketSymbol: 'USDCn', address: USDC_ADDRESS, aToken: AAVE_V3_POLYGON_AUSDC, aTokenSymbol: 'aUSDC', decimals: 6, permitDomain: 'chainId', permitVersion: '2' }),
});

export function getAsset(asset = 'usdt') {
  const key = typeof asset === 'string' ? asset.toLowerCase() : asset?.id;
  const config = ASSETS[key];
  if (!config) throw new Error('Choose a supported Polygon asset.');
  return config;
}

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

export function encodePermitNonce(owner) {
  if (!isAddress(owner)) throw new Error('Wallet address is invalid.');
  return `0x7ecebe00${owner.slice(2).toLowerCase().padStart(64, '0')}`;
}

export function validateSupplyWithPermitTransaction(tx, from, amountRaw, deadline, asset = ASSETS.usdt) {
  const token = getAsset(asset);
  if (!txBaseIsValid(tx, from) || tx.to.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      tx.data.length !== 10 + 8 * 64 || tx.data.slice(0, 10).toLowerCase() !== '0x02c205f0' ||
      addressWord(tx.data, 0) !== token.address.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw) ||
      addressWord(tx.data, 2) !== from.toLowerCase() ||
      BigInt(`0x${word(tx.data, 3)}`) !== 0n ||
      BigInt(`0x${word(tx.data, 4)}`) !== BigInt(deadline) ||
      BigInt(`0x${word(tx.data, 5)}`) !== 27n && BigInt(`0x${word(tx.data, 5)}`) !== 28n ||
      BigInt(`0x${word(tx.data, 6)}`) === 0n || BigInt(`0x${word(tx.data, 7)}`) === 0n ||
      BigInt(deadline) <= BigInt(Math.floor(Date.now() / 1000)) ||
      BigInt(deadline) > BigInt(Math.floor(Date.now() / 1000) + 1300)) {
    throw new Error(`The Aave permit supply did not match your wallet, Polygon ${token.symbol}, exact amount, short deadline and verified pool. Nothing was sent.`);
  }
  return true;
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

export function validateApprovalTransaction(tx, from, amountRaw, asset = ASSETS.usdt) {
  const token = getAsset(asset);
  if (!txBaseIsValid(tx, from) || tx.to.toLowerCase() !== token.address.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x095ea7b3' ||
      addressWord(tx.data, 0) !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw)) {
    throw new Error(`The Aave approval details did not match the exact ${token.symbol} amount and official Polygon market. Nothing was sent.`);
  }
  return true;
}

export function prepareExactApprovalTransaction(tx, from, amountRaw, currentAllowanceRaw = 0n, asset = ASSETS.usdt) {
  const token = getAsset(asset);
  if (!txBaseIsValid(tx, from) || tx.to.toLowerCase() !== token.address.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x095ea7b3' ||
      addressWord(tx.data, 0) !== AAVE_V3_POLYGON_POOL.toLowerCase()) {
    throw new Error(`The Aave approval sender, ${token.symbol} token, spender or Polygon network did not match. Nothing was sent.`);
  }

  const requested = BigInt(amountRaw);
  const apiAllowance = BigInt(`0x${word(tx.data, 1)}`);
  if (apiAllowance < requested) {
    throw new Error(`The Aave approval plan was below the requested ${token.symbol} amount. Nothing was sent.`);
  }
  if (apiAllowance === requested) return tx;
  if (BigInt(currentAllowanceRaw) !== 0n) {
    throw new Error('Aave requested a broader approval while this wallet already has an allowance. Refresh the wallet before trying again. Nothing was sent.');
  }

  // Keep Aave's verified sender, token, spender, chain and zero value, but narrow
  // a broader API allowance to the exact amount when the on-chain allowance is zero.
  const exactData = `0x095ea7b3${AAVE_V3_POLYGON_POOL.slice(2).toLowerCase().padStart(64, '0')}${requested.toString(16).padStart(64, '0')}`;
  const exactTransaction = { ...tx, data: exactData };
  validateApprovalTransaction(exactTransaction, from, requested, token);
  return exactTransaction;
}

export function validateSupplyTransaction(tx, from, amountRaw, asset = ASSETS.usdt) {
  const token = getAsset(asset);
  if (!txBaseIsValid(tx, from) || tx.operation !== 'SUPPLY' || tx.to.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x617ba037' ||
      addressWord(tx.data, 0) !== token.address.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw) ||
      addressWord(tx.data, 2) !== from.toLowerCase()) {
    throw new Error(`The Aave supply details did not match your wallet, ${token.symbol}, market and exact amount. Nothing was sent.`);
  }
  return true;
}

export function validateWithdrawTransaction(tx, from, amountRaw, asset = ASSETS.usdt) {
  const token = getAsset(asset);
  if (!txBaseIsValid(tx, from) || tx.operation !== 'WITHDRAW' || tx.to.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() ||
      tx.data.slice(0, 10).toLowerCase() !== '0x69328dec' ||
      addressWord(tx.data, 0) !== token.address.toLowerCase() ||
      BigInt(`0x${word(tx.data, 1)}`) !== BigInt(amountRaw) ||
      addressWord(tx.data, 2) !== from.toLowerCase()) {
    throw new Error(`The Aave withdrawal details did not match your wallet, ${token.symbol}, market and exact amount. Nothing was sent.`);
  }
  return true;
}

export function amountFromInput(input, mode, walletBalance, positionBalance, decimals = TOKEN_DECIMALS, symbol = 'USDT') {
  const amount = parseTokenAmount(input, decimals);
  const ceiling = mode === 'supply' ? BigInt(walletBalance ?? 0) : BigInt(positionBalance ?? 0);
  if (amount > ceiling) throw new Error(mode === 'supply' ? `Your ${symbol} balance changed after the wallet action. Enter an amount within your current available balance.` : `Your Aave ${symbol} position changed after the wallet action. Enter an amount within your current supplied balance.`);
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
