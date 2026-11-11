import { recoverMessageAddress } from 'viem';

export function normalizeNimiqAddress(value) {
  return String(value || '').replace(/\s/g, '').toUpperCase();
}

export function nimPaymentMatchesQuote(tx, quote, feeAddress, now = Date.now()) {
  if (!tx || tx.executionResult !== true || !tx.blockHeight) return false;
  if (normalizeNimiqAddress(tx.to) !== normalizeNimiqAddress(feeAddress)) return false;
  if (String(tx.value) !== String(quote.fee)) return false;
  const data = String(tx.recipientData || '').replace(/^0x/i, '').toLowerCase();
  const memo = [...new TextEncoder().encode(String(quote.memo || ''))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (data !== memo) return false;
  // Nimiq timestamps are seconds while quote expiry uses milliseconds.
  if (quote.expiresAt < now && Number(tx.timestamp) * 1000 > quote.expiresAt) return false;
  return true;
}

export function goalMessage({ owner, nonce, action, asset, targetRaw = '', date = '' }) {
  return `Current savings goal ${action}\nWallet: ${owner.toLowerCase()}\nNonce: ${nonce}\nAsset: ${asset}\nTarget raw: ${targetRaw}\nTarget date: ${date}`;
}

export async function signatureMatchesOwner(message, signature, owner) {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    return recovered.toLowerCase() === String(owner).toLowerCase();
  } catch {
    return false;
  }
}

export function relaySupplyPositionMatches({ receipt, hash, relayer, pool, before, after, amount }) {
  if (!receipt || receipt.status !== 'success' ||
      String(receipt.transactionHash || '').toLowerCase() !== String(hash || '').toLowerCase() ||
      String(receipt.from || '').toLowerCase() !== String(relayer || '').toLowerCase() ||
      String(receipt.to || '').toLowerCase() !== String(pool || '').toLowerCase()) return false;
  try {
    return BigInt(after) + 2n >= BigInt(before) + BigInt(amount);
  } catch {
    return false;
  }
}
