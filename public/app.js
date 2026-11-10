import {
  AAVE_GRAPHQL,
  AAVE_V3_POLYGON_POOL,
  ASSETS,
  CHAIN_ID,
  POLYGON_HEX_CHAIN_ID,
  amountFromInput,
  encodeAllowance,
  encodeBalanceOf,
  encodePermitNonce,
  estimateSimpleYield,
  expectedBalanceDelta,
  formatTokenAmount,
  getAsset,
  isAddress,
  parseTokenAmount,
  prepareExactApprovalTransaction,
  validateApprovalTransaction,
  validateSupplyTransaction,
  validateSupplyWithPermitTransaction,
  validateWithdrawTransaction,
} from './domain.mjs';

const $ = (id) => document.getElementById(id);
const cleanCopy = (value) => String(value ?? '').replace(/-/g, ' ');
const RATE_HISTORY_KEY = 'current.apy-history.v1';
const FX_CACHE_KEY = 'current.usd-ngn.v1';
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const RELAY_PENDING_KEY = 'current.relay.pending.v1';
let nimRelayEnabled = false;
let nimRelayStatusUnavailable = false;
let nimRelayConfigurationIssues = [];
function wasWalletDismissed() { try { return sessionStorage.getItem('current-wallet-dismissed') === 'true'; } catch { return false; } }
const state = {
  market: null,
  wallet: null,
  walletData: null,
  walletChainId: null,
  fx: null,
  fxError: false,
  walletReturnSnapshot: null,
  savedGoals: {},
  walletDismissed: wasWalletDismissed(),
  assetId: 'usdt',
  mode: 'supply',
  gqlBusy: false,
  pendingAction: null,
  busy: false,
  toastTimer: null,
};

function currentAsset() { return getAsset(state.assetId); }
function rateHistoryKey() { return state.assetId === 'usdt' ? RATE_HISTORY_KEY : `${RATE_HISTORY_KEY}:${state.assetId}`; }

const nairaFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

function formatNaira(rawUsdt) {
  if (!state.fx || rawUsdt === null || rawUsdt === undefined) return 'Unavailable';
  const usdValue = Number(BigInt(rawUsdt)) / (10 ** currentAsset().decimals);
  const nairaValue = usdValue * state.fx.rate;
  return Number.isFinite(nairaValue) ? nairaFormatter.format(nairaValue) : 'Unavailable';
}

function readFxCache() {
  try {
    const data = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
    if (data && Number.isFinite(data.rate) && data.rate > 0 && Number.isFinite(data.fetchedAt) && Number.isFinite(data.updatedAt)) return data;
  } catch { /* FX cache is optional and browser-local. */ }
  return null;
}

function renderNairaDisplays() {
  const fx = state.fx;
  $('fx-rate-value').textContent = fx ? `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(fx.rate)} per $1` : 'Unavailable';
  if (!fx) {
    $('fx-rate-note').innerHTML = state.fxError
      ? 'Naira conversion unavailable. <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates by ExchangeRate-API</a>'
      : 'Loading indicative naira conversion…';
  } else {
    const updated = new Date(fx.updatedAt * 1000);
    const ageHours = (Date.now() - fx.updatedAt * 1000) / 3_600_000;
    const freshness = ageHours > 48 ? ' · rate is stale' : '';
    $('fx-rate-note').innerHTML = `Indicative only · ${currentAsset().symbol} treated as ≈$1 · updated ${updated.toLocaleDateString('en-NG')} UTC${freshness}. <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates by ExchangeRate-API</a>`;
  }
  $('position-naira').textContent = state.walletData
    ? `Approx. ${formatNaira(state.walletData.aTokenBalance)} · indicative USD/NGN conversion`
    : 'Connect a Polygon wallet to see the indicative naira value of this position.';
  renderYieldLens();
  updateAmountSummary();
  renderSavingsGoal();
}

async function loadNairaRate() {
  const cached = readFxCache();
  if (cached) state.fx = cached;
  renderNairaDisplays();
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(FX_ENDPOINT, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`FX service returned HTTP ${response.status}.`);
    const body = await response.json();
    const rate = Number(body?.rates?.NGN);
    const updatedAt = Number(body?.time_last_update_unix);
    if (body?.result !== 'success' || body?.base_code !== 'USD' || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(updatedAt)) throw new Error('FX service returned invalid USD/NGN data.');
    state.fx = { rate, updatedAt, fetchedAt: Date.now() };
    state.fxError = false;
    try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(state.fx)); } catch { /* Use the live rate in memory if storage is unavailable. */ }
  } catch {
    state.fxError = true;
  } finally {
    clearTimeout(timeout);
    renderNairaDisplays();
  }
}

const MARKET_QUERY = `query { market(request: { address: "${AAVE_V3_POLYGON_POOL}", chainId: ${CHAIN_ID} }) {
  name address chain { name chainId }
  reserves(request: { reserveType: SUPPLY }) {
    underlyingToken { address symbol decimals }
    aToken { address symbol decimals }
    isPaused isFrozen
    supplyInfo { apy { formatted value } supplyCapReached supplyCap { amount { value } } }
    borrowInfo { availableLiquidity { amount { value } } }
  }
} }`;

async function gql(query, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(AAVE_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Aave API returned HTTP ${response.status}.`);
    const body = await response.json();
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join(' '));
    if (!body.data) throw new Error('Aave API returned no market data.');
    return body.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Aave market data timed out. Try again when the service is available.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function verifyMarketIdentity(market) {
  if (!market || market.address?.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() || Number(market.chain?.chainId) !== CHAIN_ID) {
    throw new Error('Aave V3 Polygon did not match the verified market address. Transactions are disabled.');
  }
}

function findAssetReserve(market, asset = currentAsset()) {
  verifyMarketIdentity(market);
  const reserve = market.reserves?.find((item) => item.underlyingToken?.address?.toLowerCase() === asset.address.toLowerCase());
  if (!reserve || Number(reserve.underlyingToken.decimals) !== asset.decimals ||
      reserve.aToken?.address?.toLowerCase() !== asset.aToken.toLowerCase()) {
    throw new Error(`The live Aave ${asset.symbol} reserve did not match the verified Polygon ${asset.symbol} and ${asset.aTokenSymbol} contracts. Transactions are disabled.`);
  }
  return reserve;
}

function setSelectedReserve() {
  if (!state.market) return;
  try {
    state.market.reserve = findAssetReserve(state.market);
    state.market.reserveError = null;
  } catch (error) {
    state.market.reserve = null;
    state.market.reserveError = error.message;
  }
}

function setMarketBusy(busy) {
  state.gqlBusy = busy;
  $('refresh-market').disabled = busy;
  $('refresh-market').classList.toggle('is-loading', busy);
  $('refresh-market').setAttribute('aria-busy', String(busy));
  if (busy) {
    $('market-state').classList.remove('is-error', 'is-paused');
    $('market-state').innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Checking</span>';
  }
  renderWalletControls();
  renderYieldLens();
}

async function loadMarket({ announce = false } = {}) {
  if (state.gqlBusy) return;
  setMarketBusy(true);
  $('market-error').hidden = true;
  $('apy-value').className = 'rate-value is-loading';
  $('apy-value').setAttribute('aria-busy', 'true');
  $('apy-value').innerHTML = '<span class="loading-copy">Checking live rate</span><span class="rate-percent"></span>';
  try {
    const data = await gql(MARKET_QUERY);
    const market = data.market;
    verifyMarketIdentity(market);
    state.market = { ...market, fetchedAt: new Date() };
    setSelectedReserve();
    renderMarket();
    if (announce) showToast('Live Aave rate updated.');
    if (state.wallet) await refreshWallet();
  } catch (error) {
    state.market = null;
    $('apy-value').className = 'rate-value is-error';
    $('apy-value').removeAttribute('aria-busy');
    $('apy-value').textContent = 'Rate unavailable';
    $('market-state').className = 'live-badge is-error';
    $('market-state').innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Unavailable</span>';
    $('reserve-status').textContent = 'Live status unavailable';
    $('freshness').textContent = 'No current Aave reserve response is available.';
    $('market-error').textContent = cleanCopy(error.message || 'Could not load live Aave market data.');
    $('market-error').hidden = false;
    window.dispatchEvent(new CustomEvent('current:rate', { detail: { error: true } }));
    if (announce) showToast('Live Aave data could not be refreshed.', 'error');
    renderWalletControls();
    renderYieldLens();
  } finally {
    setMarketBusy(false);
  }
}

function renderMarket() {
  const { reserve, fetchedAt } = state.market;
  if (!reserve) {
    $('apy-value').className = 'rate-value is-error';
    $('apy-value').removeAttribute('aria-busy');
    $('apy-value').textContent = 'Rate unavailable';
    $('market-state').className = 'live-badge is-error';
    $('market-state').innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Unavailable</span>';
    $('reserve-status').textContent = `${currentAsset().symbol} reserve unavailable`;
    $('freshness').textContent = `Aave market data was checked ${fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, but this asset reserve could not be verified.`;
    $('market-data-note').textContent = 'Selected reserve unavailable';
    $('market-error').textContent = cleanCopy(state.market.reserveError || 'The selected Aave reserve is unavailable.');
    $('market-error').hidden = false;
    window.dispatchEvent(new CustomEvent('current:rate', { detail: { error: true, assetId: state.assetId } }));
    renderWalletControls();
    renderYieldLens();
    return;
  }
  const paused = reserve.isPaused || reserve.isFrozen || reserve.supplyInfo?.supplyCapReached;
  const rate = reserve.supplyInfo?.apy?.formatted;
  if (typeof rate !== 'string' || !/^\d+(?:\.\d+)?$/.test(rate)) throw new Error('Aave returned an invalid supply rate.');
  $('apy-value').className = 'rate-value';
  $('apy-value').removeAttribute('aria-busy');
  $('apy-value').innerHTML = `<span>${escapeHtml(rate)}</span><span class="rate-percent">%</span>`;
  $('market-state').className = `live-badge${paused ? ' is-paused' : ''}`;
  $('market-state').innerHTML = `<span class="live-dot" aria-hidden="true"></span><span>${paused ? 'Supply unavailable' : 'Market live'}</span>`;
  $('reserve-status').textContent = reserve.isPaused ? 'Paused by protocol' : reserve.isFrozen ? 'Frozen by protocol' : reserve.supplyInfo?.supplyCapReached ? 'Supply cap reached' : 'Open for supply';
  $('freshness').textContent = `Aave V3 market API · fetched ${fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. APY may change; API indexing delay is possible.`;
  $('market-data-note').textContent = paused ? 'Live data · supply currently unavailable' : 'Live Aave market data';
  recordRateSnapshot(Number(rate));
  window.dispatchEvent(new CustomEvent('current:rate', { detail: { value: `${rate}%`, source: `Current ${currentAsset().symbol} Aave rate`, assetId: state.assetId } }));
  $('market-error').hidden = true;
  renderRateHistory(rate);
  renderWalletControls();
  renderYieldLens();
}

function readRateHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(rateHistoryKey()) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => Number.isFinite(entry.t) && Number.isFinite(entry.r)) : [];
  } catch { return []; }
}

function recordRateSnapshot(rate) {
  if (!Number.isFinite(rate) || rate < 0) return;
  try {
    const history = readRateHistory();
    const now = Date.now();
    const last = history.at(-1);
    if (last && now - last.t < 60_000) return;
    history.push({ t: now, r: rate });
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem(rateHistoryKey(), JSON.stringify(history.filter((entry) => entry.t >= cutoff).slice(-720)));
  } catch { /* Rate chart history is best-effort browser-local data. */ }
}

function renderRateHistory(currentRate) {
  const history = readRateHistory();
  $('rate-history-current').textContent = `${currentRate}% now`;
  if (!history.length) return;
  const min = Math.min(...history.map((entry) => entry.r));
  const max = Math.max(...history.map((entry) => entry.r));
  const spread = max - min || Math.max(max * .1, .01);
  const points = history.map((entry, index) => {
    const x = history.length < 2 ? 160 : 2 + (index / (history.length - 1)) * 316;
    const y = 56 - ((entry.r - (min - spread * .1)) / (spread * 1.2)) * 48;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  $('rate-history-line').setAttribute('points', points);
  const firstSeen = new Date(history[0].t);
  $('rate-history-range').textContent = history.length < 2
    ? `First observation · ${firstSeen.toLocaleDateString()}`
    : `${firstSeen.toLocaleDateString()} – ${new Date(history.at(-1).t).toLocaleDateString()} · ${history.length} observations`;
}

function readSavingsGoal() { return state.savedGoals[state.assetId] || null; }

function renderSavingsGoal() {
  const targetInput = $('goal-target');
  if (!targetInput) return;
  const goal = readSavingsGoal();
  const connected = Boolean(state.wallet && state.walletData);
  targetInput.disabled = !state.wallet;
  $('goal-date').disabled = !state.wallet;
  $('goal-save').disabled = !state.wallet;
  $('goal-clear').hidden = !goal;
  $('goal-progress-wrap').hidden = !goal;
  if (goal) {
    targetInput.value = formatTokenAmount(BigInt(goal.targetRaw), currentAsset().decimals);
    $('goal-date').value = goal.date;
  } else if (!state.wallet) {
    targetInput.value = '';
    $('goal-date').value = '';
  }
  if (!goal) {
    $('goal-status').textContent = state.wallet ? 'Choose a target and date. Sign a wallet message to save it to Current across devices.' : 'Connect a wallet to create a wallet-linked goal.';
    $('goal-progress-copy').textContent = connected ? 'Save a goal to start tracking this position.' : 'Connect your wallet to track progress.';
    $('goal-projection').textContent = '';
    return;
  }
  $('goal-status').textContent = connected ? `Progress uses the live ${currentAsset().aTokenSymbol} balance read from Polygon.` : 'Goal saved with Current. Connect this wallet on Polygon to refresh progress.';
  if (!connected) {
    $('goal-progress-copy').textContent = 'Connect this wallet on Polygon to refresh progress.';
    $('goal-progress-percent').textContent = '—';
    $('goal-progress-track').setAttribute('aria-valuenow', '0');
    $('goal-progress-fill').style.width = '0%';
    $('goal-projection').textContent = 'Your goal is stored with Current and linked to this wallet address.';
    return;
  }
  const target = BigInt(goal.targetRaw);
  const balance = state.walletData.aTokenBalance;
  const pct = Number(balance * 10_000n / target) / 100;
  const shownPct = Math.min(100, pct);
  $('goal-progress-percent').textContent = `${shownPct.toFixed(shownPct % 1 ? 1 : 0)}%`;
  $('goal-progress-track').setAttribute('aria-valuenow', String(Math.round(shownPct)));
  $('goal-progress-fill').style.width = `${shownPct}%`;
  $('goal-progress-copy').textContent = `${formatTokenAmount(balance)} of ${formatTokenAmount(target)} USDT · target ${new Date(`${goal.date}T00:00:00`).toLocaleDateString()}`;
  const days = Math.ceil((new Date(`${goal.date}T23:59:59`).getTime() - Date.now()) / 86_400_000);
  if (balance >= target) {
    $('goal-projection').textContent = `You have reached this target based on the current Polygon position. Approximate target value: ${formatNaira(target)}.`;
  } else if (days <= 0) {
    $('goal-projection').textContent = 'Target date has passed. Update the date or keep tracking progress.';
  } else if (!marketIsFresh()) {
    $('goal-projection').textContent = 'Refresh the live Aave rate to see an illustrative estimate by your target date.';
  } else {
    const apy = state.market.reserve.supplyInfo.apy.formatted;
    const estimate = balance + estimateSimpleYield(balance, apy, Math.min(days, 3650));
    const gap = target > estimate ? target - estimate : 0n;
    $('goal-projection').textContent = `At today’s ${apy}% APY, the position could be about ${formatTokenAmount(estimate)} USDT (${formatNaira(estimate)}) by then if the rate stayed unchanged. ${gap ? `Illustrative gap: ${formatTokenAmount(gap)} USDT (${formatNaira(gap)}).` : 'That projection reaches your target.'} Variable rates can change; this is not guaranteed.`;
  }
  $('goal-progress-copy').textContent = $('goal-progress-copy').textContent.replaceAll(' USDT', ` ${currentAsset().symbol}`);
  $('goal-projection').textContent = $('goal-projection').textContent.replaceAll(' USDT', ` ${currentAsset().symbol}`);
}

function goalSigningMessage({ owner, nonce, action, asset, targetRaw = '', date = '' }) {
  return `Current savings goal ${action}\nWallet: ${owner.toLowerCase()}\nNonce: ${nonce}\nAsset: ${asset}\nTarget raw: ${targetRaw}\nTarget date: ${date}`;
}

async function requestGoalAccess(action, goal = {}) {
  if (!state.wallet) throw new Error('Connect your wallet to access its saved goal.');
  const owner = state.wallet;
  await recheckBeforeWrite();
  const asset = currentAsset();
  const nonceResponse = await fetch('/api/goals/nonce', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner }), cache: 'no-store',
  });
  const nonceBody = await nonceResponse.json();
  if (!nonceResponse.ok) throw new Error(nonceBody.error || 'Could not start wallet authorization.');
  const targetRaw = action === 'save' ? String(goal.targetRaw) : '';
  const date = action === 'save' ? String(goal.date) : '';
  const message = goalSigningMessage({ owner, nonce: nonceBody.nonce, action, asset: asset.id, targetRaw, date });
  const hexMessage = `0x${[...new TextEncoder().encode(message)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  const signature = await provider().request({ method: 'personal_sign', params: [hexMessage, owner] });
  await recheckBeforeWrite();
  if (state.wallet?.toLowerCase() !== owner.toLowerCase() || state.assetId !== asset.id) throw new Error('Wallet or asset changed during goal authorization. Please retry.');
  const response = await fetch('/api/goals/access', {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ owner, nonce: nonceBody.nonce, action, asset: asset.id, targetRaw, date, signature }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not access the saved goal.');
  return data.goal;
}

async function loadSavingsGoal() {
  if (!state.wallet) { state.savedGoals = {}; renderSavingsGoal(); return; }
  const assetId = state.assetId;
  $('goal-status').textContent = 'Sign a read-only wallet message to load this goal across your devices.';
  try {
    const goal = await requestGoalAccess('read');
    if (state.assetId !== assetId) return;
    if (goal && /^\d+$/.test(String(goal.targetRaw)) && /^\d{4}-\d{2}-\d{2}$/.test(goal.date)) state.savedGoals[assetId] = goal;
    else delete state.savedGoals[assetId];
    renderSavingsGoal();
    if (!goal) $('goal-status').textContent = 'No saved goal for this asset and wallet yet.';
  } catch (error) {
    if (state.assetId === assetId) $('goal-status').textContent = cleanCopy(error.message || 'Could not load the saved goal.');
  }
}

async function saveSavingsGoal(event) {
  event.preventDefault();
  if (!state.wallet) { $('goal-status').textContent = 'Connect a wallet before saving a goal.'; return; }
  try {
    const targetRaw = parseTokenAmount($('goal-target').value, currentAsset().decimals);
    const date = $('goal-date').value;
    const dateTime = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T23:59:59`).getTime() : NaN;
    if (!Number.isFinite(dateTime)) throw new Error('Choose a valid target date.');
    if (dateTime <= Date.now()) throw new Error('Choose a future target date.');
    $('goal-save').disabled = true;
    const goal = await requestGoalAccess('save', { targetRaw: targetRaw.toString(), date });
    state.savedGoals[state.assetId] = goal;
    renderSavingsGoal();
    $('goal-status').textContent = 'Goal saved to Current and linked to this wallet.';
  } catch (error) { $('goal-status').textContent = cleanCopy(error.message || 'Could not save this goal.'); }
  finally { $('goal-save').disabled = !state.wallet; }
}

async function clearSavingsGoal() {
  if (!state.wallet) return;
  $('goal-clear').disabled = true;
  try {
    await requestGoalAccess('delete');
    delete state.savedGoals[state.assetId];
    $('goal-target').value = '';
    $('goal-date').value = '';
    renderSavingsGoal();
    $('goal-status').textContent = 'Saved goal removed from Current for this wallet.';
  } catch (error) { $('goal-status').textContent = cleanCopy(error.message || 'Could not remove the saved goal.'); }
  finally { $('goal-clear').disabled = !state.wallet; }
}

function renderYieldLens() {
  const input = $('estimate-principal');
  if (!marketIsFresh()) {
    input.disabled = true;
    $('estimate-30-naira').textContent = 'Unavailable';
    $('estimate-365-naira').textContent = 'Unavailable';
    $('estimate-30').textContent = '—';
    $('estimate-365').textContent = '—';
    $('yield-estimate-status').textContent = state.gqlBusy ? 'Refreshing the live Aave rate…' : 'A live Aave rate is required before estimating.';
    return;
  }
  input.disabled = false;
  const amount = input.value.trim();
  if (!amount) {
    $('estimate-30-naira').textContent = 'Unavailable';
    $('estimate-365-naira').textContent = 'Unavailable';
    $('estimate-30').textContent = '—';
    $('estimate-365').textContent = '—';
    $('yield-estimate-status').textContent = `Using the current ${state.market.reserve.supplyInfo.apy.formatted}% Aave supply APY when you enter an amount.`;
    return;
  }
  try {
    const principal = parseTokenAmount(amount, currentAsset().decimals);
    const apy = state.market.reserve.supplyInfo.apy.formatted;
    state.yield30 = estimateSimpleYield(principal, apy, 30);
    state.yield365 = estimateSimpleYield(principal, apy, 365);
    $('estimate-30').textContent = `${formatTokenAmount(state.yield30, currentAsset().decimals)} ${currentAsset().symbol}`;
    $('estimate-365').textContent = `${formatTokenAmount(state.yield365, currentAsset().decimals)} ${currentAsset().symbol}`;
    $('estimate-30-naira').textContent = formatNaira(state.yield30);
    $('estimate-365-naira').textContent = formatNaira(state.yield365);
    $('yield-estimate-status').textContent = `Illustrative gross estimate at the live ${apy}% APY, fetched with the Aave market data above.`;
  } catch (error) {
    $('estimate-30-naira').textContent = 'Unavailable';
    $('estimate-365-naira').textContent = 'Unavailable';
    $('estimate-30').textContent = '—';
    $('estimate-365').textContent = '—';
    $('yield-estimate-status').textContent = cleanCopy(error.message);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const discoveredEthereumProviders = new Map();
window.addEventListener('eip6963:announceProvider', (event) => {
  const detail = event.detail;
  if (detail?.provider && typeof detail.provider.request === 'function') {
    discoveredEthereumProviders.set(detail.info?.uuid || detail.info?.rdns || detail.info?.name || 'provider', detail.provider);
  }
});
// Nimiq Pay supports EIP-6963 discovery in addition to window.ethereum.
window.dispatchEvent(new Event('eip6963:requestProvider'));

function provider() {
  if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum;
  return discoveredEthereumProviders.values().next().value || null;
}

function setWalletMessage(message, error = false) {
  $('position-status').textContent = cleanCopy(message);
  $('position-status').style.color = error ? 'var(--red)' : '';
}

function shortAddress(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

async function connectWallet() {
  const injected = provider();
  if (!injected) {
    setWalletMessage("Nimiq Pay's EVM wallet provider was not detected. Open Current from Nimiq Pay > Mini Apps, or load it using Nimiq Pay's Custom URL. If this message persists inside Nimiq Pay, contact Nimiq support.", true);
    showToast('No Nimiq Pay EVM provider was detected. No wallet was connected.', 'error');
    return;
  }
  setBusy(true);
  try {
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !isAddress(accounts[0])) throw new Error('Nimiq Pay did not return a valid EVM account.');
    state.wallet = accounts[0];
    state.savedGoals = {};
    const chain = await injected.request({ method: 'eth_chainId' });
    renderWalletHeader();
    renderSavingsGoal();
    await refreshWallet();
    if (parseChainId(chain) !== CHAIN_ID) {
      setWalletMessage('Balance read from Polygon. Switch the wallet to Polygon before transacting.');
      $('gas-balance').textContent = 'Switch wallet to Polygon to transact';
      renderWalletControls();
      showToast('Polygon balance shown. Switch the wallet to Polygon before transacting.', 'info');
      return;
    }
    void loadSavingsGoal();
    renderWalletControls();
    showToast(`Connected ${shortAddress(state.wallet)} through the wallet provider.`);
  } catch (error) {
    if (isUserRejected(error)) setWalletMessage('Connection cancelled. No wallet was connected.', true);
    else setWalletMessage(error.message || 'Wallet connection failed.', true);
    showToast(isUserRejected(error) ? 'Wallet connection cancelled.' : (error.message || 'Wallet connection failed.'), 'error');
  } finally {
    setBusy(false);
  }
}

function isUserRejected(error) { return error?.code === 4001 || error?.code === 'ACTION_REJECTED'; }

function parseChainId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value, 16);
  if (/^[0-9]+$/.test(value)) return Number(value);
  return null;
}

async function switchToPolygon() {
  const injected = provider();
  if (!injected) return connectWallet();
  setBusy(true);
  try {
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_HEX_CHAIN_ID }] });
    const chain = await injected.request({ method: 'eth_chainId' });
    if (parseChainId(chain) !== CHAIN_ID) throw new Error('The wallet is still on a different network.');
    await refreshWallet();
    void loadSavingsGoal();
    showToast('Polygon is connected. Review the live position before taking action.');
  } catch (error) {
    if (isUserRejected(error)) {
      setWalletMessage('Network switch cancelled. Transactions remain disabled.', true);
      showToast('Network switch cancelled. Nothing was sent.', 'error');
    } else {
      setWalletMessage(error.message || 'Could not switch to Polygon.', true);
      showToast(error.message || 'Could not switch to Polygon.', 'error');
    }
  } finally { setBusy(false); }
}

const POLYGON_READ_RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'];

async function polygonRead(method, params) {
  for (const url of POLYGON_READ_RPCS) {
    try {
      const response = await fetch(url, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload.error && payload.result !== undefined) return payload.result;
    } catch {}
  }
  throw new Error('Polygon balance service is temporarily unavailable. Refresh and try again.');
}

async function ethCall(to, data) {
  const result = await polygonRead('eth_call', [{ to, data }, 'latest']);
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('Polygon returned an invalid contract read result.');
  return BigInt(result);
}

async function readTokenNameForPermit(asset = currentAsset()) {
  const raw = await provider().request({ method: 'eth_call', params: [{ to: asset.address, data: '0x06fdde03' }, 'latest'] });
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw) || raw.length < 130) throw new Error(`${asset.symbol} returned an invalid permit name. No transaction was sent.`);
  const data = raw.slice(2);
  const offset = Number(BigInt(`0x${data.slice(0, 64)}`));
  if (!Number.isSafeInteger(offset) || offset < 32 || offset * 2 + 64 > data.length) throw new Error(`${asset.symbol} permit name data was malformed. No transaction was sent.`);
  const start = offset * 2;
  const length = Number(BigInt(`0x${data.slice(start, start + 64)}`));
  const hex = data.slice(start + 64, start + 64 + length * 2);
  if (!Number.isSafeInteger(length) || length < 1 || hex.length !== length * 2) throw new Error(`${asset.symbol} permit name data was incomplete. No transaction was sent.`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(hex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16))); }
  catch { throw new Error(`${asset.symbol} permit name was not valid UTF-8. No transaction was sent.`); }
}

async function signSupplyPermit(amount, asset = currentAsset()) {
  const injected = provider();
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const [name, nonce] = await Promise.all([
    readTokenNameForPermit(asset),
    ethCall(asset.address, encodePermitNonce(state.wallet)),
  ]);
  const domain = asset.permitDomain === 'salt'
    ? { name, version: asset.permitVersion, verifyingContract: asset.address, salt: `0x${CHAIN_ID.toString(16).padStart(64, '0')}` }
    : { name, version: asset.permitVersion, chainId: CHAIN_ID, verifyingContract: asset.address };
  const typedData = {
    types: {
      EIP712Domain: asset.permitDomain === 'salt' ? [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' },
      ] : [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    domain,
    message: {
      owner: state.wallet,
      spender: AAVE_V3_POLYGON_POOL,
      value: amount.toString(),
      nonce: nonce.toString(),
      deadline: String(deadline),
    },
  };
  const signature = await injected.request({ method: 'eth_signTypedData_v4', params: [state.wallet, JSON.stringify(typedData)] });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('The wallet did not return a valid EIP-2612 permit signature. Nothing was sent.');
  let v = Number.parseInt(signature.slice(-2), 16);
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) throw new Error('The wallet returned an unsupported permit signature. Nothing was sent.');
  const r = signature.slice(2, 66).toLowerCase();
  const s = signature.slice(66, 130).toLowerCase();
  if (/^0+$/.test(r) || /^0+$/.test(s)) throw new Error('The wallet returned an invalid permit signature. Nothing was sent.');
  return { deadline, nonce, v, r: `0x${r}`, s: `0x${s}` };
}

function makeSupplyWithPermitTransaction(amount, permit, asset = currentAsset()) {
  const addressWord = (address) => address.slice(2).toLowerCase().padStart(64, '0');
  const uintWord = (value) => BigInt(value).toString(16).padStart(64, '0');
  return {
    from: state.wallet,
    to: AAVE_V3_POLYGON_POOL,
    chainId: CHAIN_ID,
    value: '0x0',
    data: `0x02c205f0${addressWord(asset.address)}${uintWord(amount)}${addressWord(state.wallet)}${uintWord(0)}${uintWord(permit.deadline)}${uintWord(permit.v)}${permit.r.slice(2)}${permit.s.slice(2)}`,
  };
}

async function refreshWallet() {
  const injected = provider();
  if (!injected || !state.wallet) return;
  const asset = currentAsset();
  const assetId = state.assetId;
  const [accounts, chain] = await Promise.all([
    injected.request({ method: 'eth_accounts' }),
    injected.request({ method: 'eth_chainId' }),
  ]);
  if (state.assetId !== assetId) return;
  if (!Array.isArray(accounts) || !accounts[0] || accounts[0].toLowerCase() !== state.wallet.toLowerCase()) {
    state.wallet = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : null;
    state.walletData = null;
    renderWalletHeader();
    renderWalletControls();
    setWalletMessage('Wallet account changed. Refresh the position before continuing.');
    return;
  }
  const [tokenBalance, aTokenBalance, allowance, nativeBalance, scaledBalance] = await Promise.all([
    ethCall(asset.address, encodeBalanceOf(state.wallet)),
    ethCall(asset.aToken, encodeBalanceOf(state.wallet)),
    ethCall(asset.address, encodeAllowance(state.wallet, AAVE_V3_POLYGON_POOL)),
    polygonRead('eth_getBalance', [state.wallet, 'latest']).then(BigInt),
    ethCall(asset.aToken, `0x1da24f3e${state.wallet.slice(2).toLowerCase().padStart(64, '0')}`).catch(() => null),
  ]);
  if (state.assetId !== assetId) return;
  state.walletChainId = parseChainId(chain);
  state.walletData = { tokenBalance, aTokenBalance, allowance, nativeBalance, scaledBalance, fetchedAt: new Date() };
  renderWalletHeader();
  renderWalletPosition();
  renderSavingsGoal();
  $('gas-balance').textContent = `${formatTokenAmount(nativeBalance, 18, 5)} POL`;
  $('available-label').textContent = state.mode === 'supply' ? `${formatTokenAmount(tokenBalance, asset.decimals)} ${asset.symbol} available` : `${formatTokenAmount(aTokenBalance, asset.decimals)} ${asset.symbol} supplied`;
  setWalletMessage(state.walletChainId === CHAIN_ID ? 'Position read directly from Polygon' : 'Balance read from Polygon; switch the wallet to Polygon before transacting.');
  renderWalletControls();
}

function renderWalletHeader() {
  const label = state.wallet ? shortAddress(state.wallet) : 'Connect wallet';
  $('wallet-label').textContent = label;
  $('wallet-dot').classList.toggle('is-connected', Boolean(state.wallet));
  $('connect-top').setAttribute('aria-label', state.wallet ? `Connected wallet ${label}; refresh position` : 'Connect Nimiq Pay wallet');
  $('disconnect-top').hidden = !state.wallet;
  if (!state.wallet) {
    $('position-value').textContent = 'Connect your wallet';
    $('position-value').classList.remove('has-value');
    $('position-principal').textContent = '—';
    $('position-interest').textContent = '—';
    $('position-refreshed').textContent = 'Position not refreshed';
  }
}

function renderWalletPosition() {
  const marketBalance = $('market-wallet-balance');
  if (marketBalance) marketBalance.textContent = state.walletData
    ? formatTokenAmount(state.walletData.tokenBalance, currentAsset().decimals) + ' ' + currentAsset().symbol + ' available'
    : state.wallet ? 'Reading Polygon balance…' : 'Connect wallet to see your balance';
  if (!state.walletData) {
    $('position-value').textContent = state.wallet ? 'Waiting for Polygon' : 'Connect your wallet';
    $('position-naira').textContent = 'Connect a Polygon wallet to see the indicative naira value of this position.';
    $('position-value').classList.remove('has-value');
    $('position-principal').textContent = '—';
    $('position-interest').textContent = '—';
    $('position-refreshed').textContent = 'Position not refreshed';
    return;
  }
  $('position-value').textContent = `${formatTokenAmount(state.walletData.aTokenBalance, currentAsset().decimals)} ${currentAsset().symbol}`;
  $('position-naira').textContent = `Approx. ${formatNaira(state.walletData.aTokenBalance)} - indicative USD/NGN conversion`;
  $('position-value').classList.add('has-value');
  if (state.walletData.scaledBalance !== null) {
    const interest = state.walletData.aTokenBalance > state.walletData.scaledBalance
      ? state.walletData.aTokenBalance - state.walletData.scaledBalance : 0n;
    $('position-principal').textContent = `${formatTokenAmount(state.walletData.scaledBalance, currentAsset().decimals)} ${currentAsset().symbol}`;
    $('position-interest').textContent = `${formatTokenAmount(interest, currentAsset().decimals)} ${currentAsset().symbol}`;
  } else {
    $('position-principal').textContent = 'Unavailable';
    $('position-interest').textContent = 'Unavailable';
  }
  $('position-refreshed').textContent = `Last position refresh · ${state.walletData.fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function marketIsFresh() {
  return Boolean(state.market?.reserve && Date.now() - state.market.fetchedAt.getTime() < 60_000 && !state.gqlBusy);
}

function marketAllowsSupply() {
  const reserve = state.market?.reserve;
  return Boolean(marketIsFresh() && reserve && !reserve.isPaused && !reserve.isFrozen && !reserve.supplyInfo?.supplyCapReached);
}

function renderWalletControls() {
  const connected = Boolean(state.wallet);
  const onPolygon = connected && state.walletData !== null && state.walletChainId === CHAIN_ID;
  const marketFresh = marketIsFresh();
  const actionAvailable = state.mode === 'supply' ? marketAllowsSupply() : marketFresh;
  const input = $('amount-input');
  for (const asset of Object.values(ASSETS)) $(`asset-${asset.id}`).disabled = state.busy || Boolean(state.pendingAction);
  const canEnterAmount = Boolean(state.walletData && !state.busy && (state.mode === 'supply' || onPolygon));
  input.disabled = !canEnterAmount;
  $('max-button').disabled = !canEnterAmount;
  $('tab-withdraw').disabled = !onPolygon || BigInt(state.walletData?.aTokenBalance ?? 0) === 0n || state.busy;
  $('tab-supply').disabled = state.busy;
  const hasAmount = validAmountForCurrentMode();
  const canWrite = onPolygon && actionAvailable && hasAmount && BigInt(state.walletData?.nativeBalance ?? 0) > 0n && !state.busy;
  const canSwitchNetwork = connected && state.walletChainId !== CHAIN_ID && !state.busy;
  $('review-button').disabled = !canSwitchNetwork && !canWrite;
  const relayButton = $('nim-relay-button');
  relayButton.hidden = state.mode !== 'supply';
  $('nim-relay-caption').hidden = relayButton.hidden;
  const relayUnavailableReason = nimRelayStatusUnavailable
    ? 'NIM-paid gas is unavailable because relay status could not be reached. Try again when the service is available.'
    : !nimRelayEnabled
    ? `NIM-paid gas is unavailable because Worker configuration is incomplete${nimRelayConfigurationIssues.length ? `: ${nimRelayConfigurationIssues.join(', ')}` : '.'}`
    : !connected ? 'Connect a Polygon wallet before using NIM-paid gas.'
      : !onPolygon ? 'Switch to Polygon and refresh your wallet before using NIM-paid gas.'
        : !window.nimiq?.sendBasicTransactionWithData ? 'Nimiq Pay payment access is unavailable here. Open Current in the Nimiq Pay app to use NIM-paid gas.'
          : !marketFresh ? 'Live Aave market data is unavailable. Refresh it before using NIM-paid gas.'
            : !actionAvailable ? 'Aave supply is currently unavailable for this market.'
              : !hasAmount ? 'Enter a valid supply amount to use NIM-paid gas.'
                : state.busy ? 'Another wallet or market action is in progress.'
                  : '';
  relayButton.disabled = Boolean(relayUnavailableReason);
  if (!relayButton.hidden) $('nim-relay-caption').textContent = relayUnavailableReason || 'Optional relay. Review the exact NIM fee and recipient before paying. A failed relay may need manual fee review.';
  $('connect-top').disabled = state.busy;
  $('disconnect-top').disabled = state.busy;
  if (!connected) $('primary-label').textContent = 'Connect wallet';
  else if (!onPolygon) $('primary-label').textContent = 'Switch to Polygon';
  else if (!actionAvailable) $('primary-label').textContent = state.mode === 'supply' && marketFresh ? 'Supply unavailable' : 'Market unavailable';
  else if (BigInt(state.walletData.nativeBalance) === 0n) $('primary-label').textContent = 'POL needed for gas';
  else $('primary-label').textContent = state.mode === 'supply' ? 'Review supply' : 'Review withdrawal';
  $('action-caption').textContent = !connected
    ? 'Open this Mini App in Nimiq Pay to connect a wallet.'
    : !onPolygon ? 'Polygon balance is visible. Switch the wallet to Polygon before transacting.'
      : BigInt(state.walletData.nativeBalance) === 0n ? 'Add POL to your Polygon wallet before a transaction.'
        : state.mode === 'supply' ? 'Supply: exact permit signature, then one POL-fee transaction. Standard approval is available as a fallback.' : 'Your wallet will show the withdrawal transaction for approval.';
  updateAmountSummary();
}

async function loadNimRelayStatus() {
  try {
    const response = await fetch('/api/relay/status', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json();
    nimRelayEnabled = response.ok && data.enabled === true;
    nimRelayStatusUnavailable = !response.ok;
    nimRelayConfigurationIssues = Array.isArray(data.missing) ? data.missing.filter((name) => typeof name === 'string') : [];
  } catch { nimRelayEnabled = false; nimRelayStatusUnavailable = true; nimRelayConfigurationIssues = []; }
  renderWalletControls();
}

function validAmountForCurrentMode() {
  if (!state.walletData || !state.market) return false;
  try {
    amountFromInput($('amount-input').value, state.mode, state.walletData.tokenBalance, state.walletData.aTokenBalance, currentAsset().decimals, currentAsset().symbol);
    return true;
  } catch { return false; }
}

function updateAmountSummary() {
  const label = state.mode === 'supply' ? 'Amount to supply' : 'Amount to withdraw';
  $('amount-label').textContent = label;
  $('summary-label').textContent = state.mode === 'supply' ? 'You supply' : 'You withdraw';
  $('summary-value').textContent = 'Enter an amount';
  $('approval-summary').textContent = state.mode === 'supply' ? 'Exact authorization + 1 supply transaction' : 'Not required';
  $('amount-input').placeholder = state.mode === 'supply' ? '0.00' : '0.00';
  if (state.walletData && $('amount-input').value.trim()) {
    try {
      const raw = amountFromInput($('amount-input').value, state.mode, state.walletData.tokenBalance, state.walletData.aTokenBalance, currentAsset().decimals, currentAsset().symbol);
      $('summary-value').textContent = `${formatTokenAmount(raw, currentAsset().decimals)} ${currentAsset().symbol}`;
      $('summary-naira').textContent = formatNaira(raw);
      $('form-error').hidden = true;
    } catch (error) {
      $('form-error').textContent = cleanCopy(error.message);
      $('form-error').hidden = false;
      $('summary-naira').textContent = 'Unavailable';
    }
  } else { $('form-error').hidden = true; $('summary-naira').textContent = 'Unavailable'; }
  $('available-label').textContent = state.walletData
    ? `${formatTokenAmount(state.mode === 'supply' ? state.walletData.tokenBalance : state.walletData.aTokenBalance, currentAsset().decimals)} ${currentAsset().symbol} ${state.mode === 'supply' ? 'available' : 'supplied'}`
    : 'Balance unavailable';
  const enough = validAmountForCurrentMode();
  const marketAvailable = state.mode === 'supply' ? marketAllowsSupply() : marketIsFresh();
  const canSwitchNetwork = Boolean(state.wallet && state.walletChainId !== CHAIN_ID && !state.busy);
  $('review-button').disabled = !canSwitchNetwork && (!enough || !state.walletData || state.walletChainId !== CHAIN_ID || state.busy || !marketAvailable || BigInt(state.walletData?.nativeBalance ?? 0) === 0n);
}

function setMode(mode) {
  if (mode === 'withdraw' && $('tab-withdraw').disabled) return;
  state.mode = mode;
  $('tab-supply').classList.toggle('is-active', mode === 'supply');
  $('tab-withdraw').classList.toggle('is-active', mode === 'withdraw');
  $('tab-supply').setAttribute('aria-selected', String(mode === 'supply'));
  $('tab-withdraw').setAttribute('aria-selected', String(mode === 'withdraw'));
  $('amount-input').value = '';
  updateAmountSummary();
  renderWalletControls();
  showToast(`${mode === 'supply' ? 'Supply' : 'Withdrawal'} selected.`, 'info');
}

function selectAsset(assetId) {
  if (!ASSETS[assetId] || state.busy || state.pendingAction) return;
  if (state.assetId === assetId) return;
  state.assetId = assetId;
  state.walletData = null;
  $('amount-input').value = '';
  for (const asset of Object.values(ASSETS)) {
    const button = $(`asset-${asset.id}`);
    button.classList.toggle('is-active', asset.id === assetId);
    button.setAttribute('aria-pressed', String(asset.id === assetId));
  }
  const asset = currentAsset();
  document.querySelectorAll('[data-asset-label]').forEach((node) => { node.textContent = asset.symbol; });
  document.querySelectorAll('[data-atoken-label]').forEach((node) => { node.textContent = asset.aTokenSymbol; });
  $('position-note').textContent = `Estimate uses Aave’s scaled ${asset.aTokenSymbol} balance; ${asset.aTokenSymbol} transfers can affect the principal basis.`;
  $('goal-intro').textContent = `Set a ${asset.symbol} target and date. Track your ${asset.aTokenSymbol} position across devices after signing a wallet message.`;
  $('page-title').innerHTML = `Give your ${asset.symbol}<br />room to <em>grow.</em>`;
  $('rate-subline').textContent = `Aave V3 · ${asset.marketSymbol} on Polygon`;
  $('position-heading').textContent = `${asset.symbol} supplied`;
  const assetChip = document.querySelector('.asset-chip');
  if (assetChip?.lastChild?.nodeType === Node.TEXT_NODE) assetChip.lastChild.textContent = ` ${asset.symbol}`;
  $('goal-target-suffix').textContent = asset.symbol;
  $('goal-target').placeholder = `e.g. 100 ${asset.symbol}`;
  $('yield-label-suffix').textContent = asset.symbol;
  $('yield-unit-suffix').textContent = asset.symbol;
  $('amount-token-label').textContent = asset.symbol;
  $('asset-risk-copy').textContent = `Supply APY changes and is not promised. Supplying USDT or USDC involves stablecoin, smart contract, network and liquidity risks. A withdrawal can depend on available liquidity. Polygon transactions need POL for gas. Current never holds funds or asks for your seed phrase.`;
  setSelectedReserve();
  if (state.market) renderMarket();
  renderWalletHeader();
  renderWalletPosition();
  renderWalletControls();
  renderSavingsGoal();
  renderNairaDisplays();
  if (state.wallet) void loadSavingsGoal();
  if (state.wallet) refreshWallet().catch((error) => setWalletMessage(error.message, true));
}

function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle('is-busy', busy);
  renderWalletControls();
}

function showToast(message, tone = 'success') {
  const toast = $('toast');
  toast.textContent = cleanCopy(message);
  toast.dataset.tone = tone;
  toast.classList.remove('is-visible');
  void toast.offsetWidth;
  toast.classList.add('is-visible');
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.hidden = true; toast.classList.remove('is-visible'); }, 4800);
}

function makeSupplyQuery(amount, asset = currentAsset()) {
  const amountText = formatTokenAmount(amount, asset.decimals).replaceAll(',', '');
  return `query { supply(request: { market: "${AAVE_V3_POLYGON_POOL}", amount: { erc20: { currency: "${asset.address}", value: "${amountText}" } }, sender: "${state.wallet}", chainId: ${CHAIN_ID} }) {
    __typename
    ... on TransactionRequest { to from data value chainId operation }
    ... on ApprovalRequired { reason requiredAmount { value decimals } currentAllowance { value decimals } approval { to from data value chainId operation } originalTransaction { to from data value chainId operation } }
    ... on InsufficientBalanceError { required { value decimals } available { value decimals } }
  } }`;
}

function makeWithdrawQuery(amount, asset = currentAsset()) {
  const amountText = formatTokenAmount(amount, asset.decimals).replaceAll(',', '');
  return `query { withdraw(request: { market: "${AAVE_V3_POLYGON_POOL}", amount: { erc20: { currency: "${asset.address}", value: { exact: "${amountText}" } } }, sender: "${state.wallet}", chainId: ${CHAIN_ID} }) {
    __typename
    ... on TransactionRequest { to from data value chainId operation }
    ... on ApprovalRequired { reason requiredAmount { value decimals } currentAllowance { value decimals } approval { to from data value chainId operation } originalTransaction { to from data value chainId operation } }
    ... on InsufficientBalanceError { required { value decimals } available { value decimals } }
  } }`;
}

async function walletCanUseEoaPermit() {
  try {
    const code = await provider().request({ method: 'eth_getCode', params: [state.wallet, 'latest'] });
    return typeof code === 'string' && /^0x(?:0{2})*$/i.test(code);
  } catch { return false; }
}

async function prepareAction(amount) {
  const asset = currentAsset();
  const supplyOwner = state.mode === 'supply' ? state.wallet : null;
  const response = await gql(state.mode === 'supply' ? makeSupplyQuery(amount, asset) : makeWithdrawQuery(amount, asset));
  if (supplyOwner && (!state.wallet || state.mode !== 'supply' || state.wallet.toLowerCase() !== supplyOwner.toLowerCase())) {
    throw new Error('The connected wallet changed while the supply was being prepared. Refresh the balance and review again.');
  }
  const plan = response[state.mode];
  if (!plan) throw new Error('Aave did not return a transaction plan. Nothing was sent.');
  if (plan.__typename === 'InsufficientBalanceError') throw new Error(`Aave reports insufficient balance. Available: ${plan.available?.value ?? 'unavailable'} ${asset.symbol}.`);
  if (state.mode === 'supply') {
    if (plan.__typename === 'ApprovalRequired') {
      validateSupplyTransaction(plan.originalTransaction, state.wallet, amount, asset);
      const exactApproval = prepareExactApprovalTransaction(plan.approval, state.wallet, amount, state.walletData.allowance, asset);
      validateApprovalTransaction(exactApproval, state.wallet, amount, asset);
      const step = await walletCanUseEoaPermit() ? 'permit' : 'approval';
      return { kind: 'supply', amount, assetId: asset.id, owner: state.wallet, plan: { ...plan, approval: exactApproval }, step };
    }
    if (plan.__typename === 'TransactionRequest') {
      validateSupplyTransaction(plan, state.wallet, amount, asset);
      return { kind: 'supply', amount, assetId: asset.id, plan, step: 'supply' };
    }
  } else if (plan.__typename === 'TransactionRequest') {
    validateWithdrawTransaction(plan, state.wallet, amount, asset);
    return { kind: 'withdraw', amount, assetId: asset.id, plan, step: 'withdraw' };
  }
  throw new Error(`Aave returned an unsupported ${plan.__typename || 'transaction'} plan. Nothing was sent.`);
}

function setDialogPlan(action) {
  state.pendingAction = action;
  const asset = getAsset(action.assetId || 'usdt');
  const usesNimRelay = action.step === 'nimRelay';
  const isRelayAction = usesNimRelay || action.step === 'relayStatus';
  const needsApproval = action.kind === 'supply' && action.step === 'approval';
  const usesPermit = action.kind === 'supply' && action.step === 'permit';
  $('dialog-action').textContent = action.step === 'relayStatus' ? 'NIM gas relay status' : usesNimRelay ? 'Supply with NIM-paid gas' : needsApproval ? 'Approve exact spend' : action.kind === 'supply' ? 'Supply to Aave' : 'Withdraw from Aave';
  $('dialog-amount').textContent = `${formatTokenAmount(action.amount, asset.decimals)} ${asset.symbol}`;
  $('transaction-asset').textContent = `${asset.symbol} · Polygon`;
  $('transaction-target').textContent = usesNimRelay ? `Aave V3 Polygon pool · ${AAVE_V3_POLYGON_POOL}` : needsApproval
    ? `${asset.symbol} token · ${asset.address}`
    : `Aave V3 pool · ${AAVE_V3_POLYGON_POOL}`;
  $('approval-detail-row').hidden = isRelayAction || !(needsApproval || usesPermit);
  $('approval-detail-row').querySelector('dt').textContent = usesPermit ? 'Permit' : 'Allowance';
  $('approval-detail').textContent = `${formatTokenAmount(action.amount, asset.decimals)} ${asset.symbol} · exact amount${usesPermit ? ' · expires in 20 minutes' : ' · one-time approval'}`;
  $('relay-fee-row').hidden = !isRelayAction;
  $('relay-fee-detail').textContent = isRelayAction ? `${(Number(action.quote.fee) / 100000).toFixed(5)} NIM · to ${action.quote.recipient} · memo ${action.quote.memo}` : '—';
  $('network-gas-row').querySelector('dd').textContent = isRelayAction ? 'POL paid by Current relayer' : 'POL · paid from your wallet';
  $('relay-support-link').href = isRelayAction ? action.quote.supportUrl : '#';
  $('relay-support-link').hidden = !isRelayAction;
  $('dialog-status').textContent = action.step === 'relayStatus'
    ? 'Resumed a previously submitted NIM payment. Check relay status below; do not make another payment.'
    : usesNimRelay
    ? `Your wallet will first sign a NIM transfer to the displayed recipient. Current verifies that payment, then its relayer submits your exact ${asset.symbol} supply to Aave. The permit authorizes only this amount and expires shortly. A failed relay may require manual fee review; do not repeat the NIM payment.`
    : needsApproval
    ? 'Aave requests a one-time approval limited to this exact amount. The supply requires a separate confirmation afterward.'
    : usesPermit ? 'Sign a short-lived typed permit for this exact amount to Aave, then confirm one Polygon supply transaction. The permit does not move funds; the supply transaction needs POL for gas.'
    : action.kind === 'supply' ? 'The next wallet prompt will supply this exact amount to the verified Aave V3 Polygon pool.' : 'The next wallet prompt will withdraw this exact amount to your connected wallet.';
  $('permit-fallback').hidden = !usesPermit;
  $('dialog-status').classList.remove('is-error');
  $('confirm-action').disabled = false;
  $('confirm-action').querySelector('span').textContent = action.step === 'relayStatus' ? 'Check relay status' : usesNimRelay ? 'Pay NIM & supply' : needsApproval ? 'Approve in wallet' : usesPermit ? 'Sign permit and continue' : 'Continue to wallet';
  $('transaction-link').hidden = true;
  if (!$('review-dialog').open) $('review-dialog').showModal();
}

async function postRelay(path, body) {
  const response = await fetch(`/api/relay/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || result.error || 'The NIM gas relay request failed.');
    if (/^\d+$/.test(String(result.availableBalance ?? ''))) error.availableBalance = result.availableBalance;
    throw error;
  }
  return result;
}

async function prepareNimRelay() {
  if (!state.wallet || !state.walletData || !window.nimiq?.sendBasicTransactionWithData) throw new Error('Open Current inside Nimiq Pay to use the NIM gas relay.');
  if (state.mode !== 'supply') throw new Error('NIM gas relay is only available for supply actions.');
  if (!marketAllowsSupply()) throw new Error('Aave supply is unavailable or its market data is stale. Refresh and try again.');
  const asset = currentAsset();
  const amount = amountFromInput($('amount-input').value, 'supply', state.walletData.tokenBalance, state.walletData.aTokenBalance, asset.decimals, asset.symbol);
  const quote = await postRelay('quote', { owner: state.wallet, amount: amount.toString(), asset: asset.id });
  const permit = await signSupplyPermit(amount, asset);
  await recheckBeforeWrite();
  await postRelay('prepare', { quoteId: quote.id, owner: state.wallet, amount: amount.toString(), asset: asset.id, permit });
  setDialogPlan({ kind: 'supply', step: 'nimRelay', assetId: asset.id, owner: state.wallet, amount, quote, permit });
}

async function submitNimRelay(action) {
  if (action.owner.toLowerCase() !== state.wallet.toLowerCase()) throw new Error('Connected wallet changed. Reconnect and request a new quote.');
  const luna = Number(BigInt(action.quote.fee));
  if (!Number.isSafeInteger(luna) || luna < 1 || action.quote.expiresAt <= Date.now()) throw new Error('NIM fee quote is invalid or expired. Request a new quote.');
  $('dialog-status').textContent = 'Confirm the exact NIM payment in Nimiq Pay. Current has not sent the Polygon supply yet.';
  const hash = await window.nimiq.sendBasicTransactionWithData({ recipient: action.quote.recipient, value: luna, data: action.quote.memo });
  if (typeof hash !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/i.test(hash)) throw new Error('Nimiq Pay returned an unexpected transaction ID. Check Nimiq Pay activity before trying again.');
  action.nimTxHash = hash;
  action.step = 'relayStatus';
  try { sessionStorage.setItem(RELAY_PENDING_KEY, JSON.stringify({ owner: action.owner, amount: action.amount.toString(), quote: action.quote, nimTxHash: hash })); } catch { /* Relay status can still be checked in this session. */ }
  $('dialog-status').textContent = 'NIM payment submitted. Verifying its recipient, fee, and quote memo before relaying the Aave supply…';
  const result = await postRelay('submit', { quoteId: action.quote.id, nimTxHash: hash });
  $('dialog-status').textContent = result.status === 'complete'
    ? 'Supply confirmed on Polygon by the relayer.'
    : result.status === 'refund_review'
      ? 'NIM payment was received, but the supply did not complete. Do not pay again. Contact Current support for a manual fee review.'
      : 'NIM payment verified. Polygon supply is being relayed; check status before retrying.';
  if (result.polygonTxHash) setTransactionLink(result.polygonTxHash);
  $('confirm-action').querySelector('span').textContent = result.status === 'complete' || result.status === 'refund_review' ? 'Close' : 'Check relay status';
  if (result.status === 'refund_review' || result.status === 'payment_reused') $('relay-support-link').hidden = false;
  if (result.status === 'complete' || result.status === 'refund_review') {
    try { sessionStorage.removeItem(RELAY_PENDING_KEY); } catch {}
    state.pendingAction = null;
  }
}

async function checkNimRelayStatus(action) {
  const response = await fetch(`/api/relay/job/${encodeURIComponent(action.quote.id)}`, { cache: 'no-store' });
  let result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not check relay status.');
  if (result.status === 'nim_pending' && action.nimTxHash) {
    result = await postRelay('submit', { quoteId: action.quote.id, nimTxHash: action.nimTxHash });
  }
  $('dialog-status').textContent = result.status === 'complete'
    ? 'Supply confirmed on Polygon by the relayer.'
    : result.status === 'refund_review'
      ? 'NIM payment was received, but the supply did not complete. Do not pay again. Contact Current support for a manual fee review.'
      : result.status === 'pending' || result.status === 'submitted' || result.status === 'relaying'
        ? 'Polygon supply is still pending. Do not send another NIM payment.'
        : result.status === 'nim_pending'
          ? 'NIM payment is included but not finalized on Nimiq yet. Check again shortly; do not pay again.'
        : `Relay status: ${result.status}. Do not repeat a payment.`;
  if (result.polygonTxHash) setTransactionLink(result.polygonTxHash);
  if (result.status === 'refund_review' || result.status === 'payment_reused') $('relay-support-link').hidden = false;
  if (result.status === 'complete' || result.status === 'refund_review') {
    try { sessionStorage.removeItem(RELAY_PENDING_KEY); } catch {}
    state.pendingAction = null;
  }
}

function restoreRelayStatus() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RELAY_PENDING_KEY) || 'null');
    if (!saved || !saved.quote?.id || !/^(?:0x)?[0-9a-f]{64}$/i.test(saved.nimTxHash || '') || !/^\d+$/.test(saved.amount || '')) return;
    setDialogPlan({ kind: 'supply', step: 'relayStatus', assetId: saved.quote.asset || 'usdt', owner: saved.owner, amount: BigInt(saved.amount), quote: saved.quote, nimTxHash: saved.nimTxHash });
  } catch { /* Ignore corrupt session-only relay metadata. */ }
}

async function reviewSubmit(event) {
  event.preventDefault();
  if (!state.wallet) return connectWallet();
  if (!state.walletData || state.walletChainId !== CHAIN_ID) return switchToPolygon();
  if (!state.market || state.gqlBusy || Date.now() - state.market.fetchedAt.getTime() >= 60_000) return showToast('Live Aave market data is unavailable or out of date. Refresh it before preparing a transaction.');
  try {
    const amount = amountFromInput($('amount-input').value, state.mode, state.walletData.tokenBalance, state.walletData.aTokenBalance, currentAsset().decimals, currentAsset().symbol);
    setBusy(true);
    $('review-button').classList.add('is-loading');
    $('review-button').setAttribute('aria-busy', 'true');
    $('primary-label').textContent = 'Preparing exact transaction…';
    const action = await prepareAction(amount);
    setDialogPlan(action);
    showToast('Aave prepared the transaction for your review.', 'success');
  } catch (error) {
    $('form-error').textContent = cleanCopy(error.message || 'Could not prepare this transaction.');
    $('form-error').hidden = false;
    showToast(error.message || 'Could not prepare this transaction.', 'error');
  } finally {
    $('review-button').classList.remove('is-loading');
    $('review-button').removeAttribute('aria-busy');
    setBusy(false);
  }
}

async function recheckBeforeWrite() {
  const injected = provider();
  if (!injected) throw new Error('Nimiq Pay wallet provider is unavailable. Nothing was sent.');
  const [accounts, chain] = await Promise.all([
    injected.request({ method: 'eth_accounts' }), injected.request({ method: 'eth_chainId' }),
  ]);
  if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== state.wallet.toLowerCase()) throw new Error('Wallet account changed. Reconnect and review again.');
  if (parseChainId(chain) !== CHAIN_ID) throw new Error('Wallet network changed. Switch back to Polygon and review again.');
}

async function sendValidated(transaction, kind, amount, asset = currentAsset()) {
  const injected = provider();
  await recheckBeforeWrite();
  if (kind === 'approval') validateApprovalTransaction(transaction, state.wallet, amount, asset);
  if (kind === 'supply') validateSupplyTransaction(transaction, state.wallet, amount, asset);
  if (kind === 'supplyPermit') validateSupplyWithPermitTransaction(transaction, state.wallet, amount, transaction.permitDeadline, asset);
  if (kind === 'withdraw') validateWithdrawTransaction(transaction, state.wallet, amount, asset);
  const payload = { from: transaction.from, to: transaction.to, data: transaction.data, value: transaction.value || '0x0' };
  const txHash = await injected.request({ method: 'eth_sendTransaction', params: [payload] });
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('The wallet returned an invalid transaction hash. Check the wallet activity before retrying.');
  return txHash;
}

async function waitForReceipt(txHash) {
  const injected = provider();
  for (let attempt = 0; attempt < 30; attempt++) {
    const receipt = await injected.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
    if (receipt && receipt.blockNumber) {
      if (receipt.transactionHash?.toLowerCase() !== txHash.toLowerCase()) throw new Error('Polygon returned a receipt for a different transaction.');
      if (receipt.status === '0x0' || receipt.status === 0) throw new Error('The Polygon transaction reverted. No success was recorded.');
      if (receipt.status !== '0x1' && receipt.status !== 1) throw new Error('The Polygon receipt status is unknown. Check the explorer before retrying.');
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

function savedPending() {
  try {
    const item = JSON.parse(sessionStorage.getItem('current.pending') || 'null');
    if (item && isAddress(item.from) && /^0x[0-9a-fA-F]{64}$/.test(item.hash) && ['approval', 'supply', 'withdraw'].includes(item.mode) && /^\d+$/.test(String(item.amount))) return item;
  } catch { /* Ignore malformed local transaction metadata. */ }
  return null;
}

async function confirmDialogAction() {
  const action = state.pendingAction;
  if (!action || state.busy) return;
  const asset = getAsset(action.assetId || 'usdt');
  setBusy(true);
  $('confirm-action').disabled = true;
  $('confirm-action').classList.add('is-loading');
  $('confirm-action').setAttribute('aria-busy', 'true');
  try {
    if (action.step === 'relayStatus') {
      await checkNimRelayStatus(action);
      return;
    }
    if (!state.market || state.gqlBusy || Date.now() - state.market.fetchedAt.getTime() >= 60_000) {
      state.pendingAction = null;
      $('dialog-status').textContent = 'Live Aave market data expired while you reviewed this action. Refresh the market and prepare the transaction again; nothing was sent.';
      $('dialog-status').classList.add('is-error');
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      return;
    }
    await recheckBeforeWrite();
    if (action.step === 'nimRelay') {
      await submitNimRelay(action);
      return;
    }
    if (action.step === 'permit' && (!action.owner || action.owner.toLowerCase() !== state.wallet.toLowerCase())) throw new Error('The connected wallet changed after review. Recheck the balance and prepare the supply again.');
    if (action.step === 'approval') {
      state.walletReturnSnapshot = {
        wallet: state.wallet,
        mode: 'supply',
        amount: action.amount,
        tokenBalance: state.walletData.tokenBalance,
        aTokenBalance: state.walletData.aTokenBalance,
      };
      const hash = await sendValidated(action.plan.approval, 'approval', action.amount, asset);
      const pending = { hash, mode: 'approval', assetId: asset.id, from: state.wallet, amount: action.amount.toString(), before: null };
      state.pendingAction = { kind: 'reconcile', pending };
      savePending(pending);
      $('dialog-status').textContent = 'Approval submitted. Waiting for Polygon confirmation…';
      showToast('Approval sent. Waiting for Polygon confirmation.', 'info');
      setTransactionLink(hash);
      const receipt = await waitForReceipt(hash);
      if (!receipt) {
        $('dialog-status').textContent = 'Approval is still pending. Do not repeat it. Reconcile the transaction before trying again.';
        $('confirm-action').querySelector('span').textContent = 'Check status';
        $('confirm-action').disabled = false;
        return;
      }
      if (receipt.from?.toLowerCase() !== state.wallet.toLowerCase() || receipt.to?.toLowerCase() !== asset.address.toLowerCase()) {
        throw new Error(`Polygon receipt did not match the approved wallet and ${asset.symbol} token contract. Reconcile before continuing.`);
      }
      const allowance = await ethCall(asset.address, encodeAllowance(state.wallet, AAVE_V3_POLYGON_POOL));
      if (allowance !== action.amount) throw new Error('Approval receipt confirmed, but Polygon read back did not show the exact requested allowance. Supply remains disabled.');
      sessionStorage.removeItem('current.pending');
      state.pendingAction = null;
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      // Rebuild the Aave plan after allowance confirmation so the wallet gets
      // a fresh supply call, never a stale approval plan.
      const refreshedPlan = await gql(makeSupplyQuery(action.amount, asset));
      const supplyPlan = refreshedPlan.supply;
      if (!supplyPlan || supplyPlan.__typename !== 'TransactionRequest') {
        throw new Error('Approval confirmed, but Aave did not return a separate supply transaction. Refresh and review again.');
      }
      validateSupplyTransaction(supplyPlan, state.wallet, action.amount, asset);
      action.plan = supplyPlan;
      state.pendingAction = action;
      action.step = 'supply';
      $('dialog-status').textContent = 'Exact approval confirmed on Polygon. A fresh supply transaction is ready for review in Nimiq Pay.';
      showToast('Exact approval confirmed. Review the separate supply action.', 'success');
      $('confirm-action').querySelector('span').textContent = 'Supply in wallet';
      $('confirm-action').disabled = false;
      setTransactionLink(hash);
      return;
    }
    const mode = action.kind;
    const before = await ethCall(asset.aToken, encodeBalanceOf(state.wallet));
    state.walletReturnSnapshot = {
      wallet: state.wallet,
      mode,
      amount: action.amount,
      tokenBalance: state.walletData.tokenBalance,
      aTokenBalance: before,
    };
    let transaction;
    let transactionKind = mode;
    if (action.step === 'permit') {
      $('dialog-status').textContent = `Requesting a short-lived signature for the exact ${asset.symbol} amount and Aave pool…`;
      const permit = await signSupplyPermit(action.amount, asset);
      await recheckBeforeWrite();
      if (action.owner.toLowerCase() !== state.wallet.toLowerCase()) throw new Error('The connected wallet changed while the permit was signed. Nothing was sent; review the new wallet before continuing.');
      if (await ethCall(asset.address, encodePermitNonce(state.wallet)) !== permit.nonce) throw new Error(`The ${asset.symbol} permit nonce changed while you reviewed it. Reopen the action to sign a fresh permit; nothing was sent.`);
      if (await ethCall(asset.address, encodeBalanceOf(state.wallet)) < action.amount) throw new Error(`Your Polygon ${asset.symbol} balance changed below the requested amount. Refresh the wallet balance and review again; nothing was sent.`);
      transaction = makeSupplyWithPermitTransaction(action.amount, permit, asset);
      transaction.permitDeadline = permit.deadline;
      validateSupplyWithPermitTransaction(transaction, state.wallet, action.amount, permit.deadline, asset);
      transactionKind = 'supplyPermit';
    } else {
      transaction = action.step === 'supply' ? action.plan.originalTransaction || action.plan : action.plan;
    }
    const hash = await sendValidated(transaction, transactionKind, action.amount, asset);
    const pending = { hash, mode, assetId: asset.id, from: state.wallet, amount: action.amount.toString(), before: before.toString() };
    state.pendingAction = { kind: 'reconcile', pending };
    savePending(pending);
    $('dialog-status').textContent = 'Submitted to Polygon. Waiting for its receipt…';
    showToast('Transaction sent. Waiting for the Polygon receipt.', 'info');
    setTransactionLink(hash);
    const receipt = await waitForReceipt(hash);
    if (!receipt) {
      $('dialog-status').textContent = 'Still pending on Polygon. Do not submit again. You can safely reconcile this transaction later.';
      showToast('Transaction is pending on Polygon.', 'info');
      $('confirm-action').querySelector('span').textContent = 'Check status';
      $('confirm-action').disabled = false;
      return;
    }
    $('dialog-status').textContent = 'Receipt confirmed. Checking your Aave balance directly on Polygon…';
    const verified = await reconcilePosition({ hash, mode, assetId: asset.id, from: state.wallet, amount: action.amount.toString(), before: before.toString() });
    if (verified) {
      sessionStorage.removeItem('current.pending');
      $('dialog-status').textContent = `${mode === 'supply' ? 'Supply' : 'Withdrawal'} confirmed. Polygon receipt and updated ${asset.aTokenSymbol} balance both verified.`;
      $('dialog-status').classList.remove('is-error');
      showToast(`${mode === 'supply' ? 'Supply' : 'Withdrawal'} verified from the Polygon receipt and wallet position.`);
      await refreshWallet();
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      state.pendingAction = null;
    } else {
      $('dialog-status').textContent = 'Receipt confirmed, but the position read back has not reflected the expected change yet. Status remains unverified; do not repeat this transaction.';
      $('dialog-status').classList.add('is-error');
      showToast('Receipt found, but the position change is not verified yet.', 'error');
      $('confirm-action').querySelector('span').textContent = 'Check position again';
      $('confirm-action').disabled = false;
    }
  } catch (error) {
    const typedDataUnavailable = state.pendingAction?.step === 'permit' && (error?.code === -32601 || error?.code === -32004 || /method (not found|not available)|not supported|unsupported method/i.test(error?.message || ''));
    $('dialog-status').textContent = cleanCopy(typedDataUnavailable
      ? 'This wallet cannot sign the typed permit. Use “standard approval instead” to continue with an exact approval and a separate supply transaction.'
      : isUserRejected(error) ? 'Wallet request declined. No success was recorded.' : (error.message || 'Transaction failed. No success was recorded.'));
    $('dialog-status').classList.add('is-error');
    showToast(isUserRejected(error) ? 'Wallet request declined. Nothing was completed.' : (error.message || 'Transaction failed.'), 'error');
    $('confirm-action').disabled = false;
  } finally {
    $('confirm-action').classList.remove('is-loading');
    $('confirm-action').removeAttribute('aria-busy');
    setBusy(false);
    if (!document.hidden && state.walletReturnSnapshot) void refreshAfterWalletReturn(state.walletReturnSnapshot);
  }
}

function savePending(item) {
  try {
    sessionStorage.setItem('current.pending', JSON.stringify(item));
    return true;
  } catch {
    // The wallet has already submitted this transaction; keep its in-memory
    // reconciliation state even when browser storage is unavailable.
    return false;
  }
}

function setTransactionLink(hash) {
  $('transaction-link').href = `https://polygonscan.com/tx/${encodeURIComponent(hash)}`;
  $('transaction-link').hidden = false;
}

async function reconcilePosition({ hash, mode, from, amount, before, assetId = 'usdt' }) {
  const asset = getAsset(assetId);
  if (!provider() || state.wallet?.toLowerCase() !== from.toLowerCase()) return false;
  const receipt = await provider().request({ method: 'eth_getTransactionReceipt', params: [hash] });
  if (!receipt || (receipt.status !== '0x1' && receipt.status !== 1) ||
      receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
      receipt.from?.toLowerCase() !== from.toLowerCase() ||
      receipt.to?.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase()) return false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const after = await ethCall(asset.aToken, encodeBalanceOf(from));
    if (expectedBalanceDelta(before, after, amount, mode)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function reconcileSavedPending() {
  const pending = savedPending();
  if (!pending || !state.wallet || pending.from.toLowerCase() !== state.wallet.toLowerCase()) return;
  setTransactionLink(pending.hash);
  $('review-dialog').showModal();
  $('dialog-title').textContent = 'Reconcile transaction';
  $('dialog-action').textContent = 'Pending transaction';
  const asset = getAsset(pending.assetId || 'usdt');
  $('dialog-amount').textContent = pending.amount ? `${formatTokenAmount(pending.amount, asset.decimals)} ${asset.symbol}` : 'Approval';
  $('transaction-asset').textContent = `${asset.symbol} · Polygon`;
  $('dialog-status').textContent = 'Checking the saved transaction hash and receipt. No new transaction will be sent.';
  $('confirm-action').querySelector('span').textContent = 'Check status';
  $('confirm-action').disabled = false;
  state.pendingAction = { kind: 'reconcile', pending };
}

async function confirmReconciliation() {
  const { pending } = state.pendingAction || {};
  if (!pending) { $('review-dialog').close(); return; }
  setBusy(true);
  $('confirm-action').disabled = true;
  $('confirm-action').classList.add('is-loading');
  $('confirm-action').setAttribute('aria-busy', 'true');
  try {
    await recheckBeforeWrite();
    const receipt = await provider().request({ method: 'eth_getTransactionReceipt', params: [pending.hash] });
    if (!receipt) {
      $('dialog-status').textContent = 'No receipt yet. It remains pending; do not submit it again.';
      setTransactionLink(pending.hash);
      $('confirm-action').disabled = false;
      return;
    }
    if (receipt.status === '0x0' || receipt.status === 0) {
      sessionStorage.removeItem('current.pending');
      $('dialog-status').textContent = 'Polygon reports that this transaction reverted. No success was recorded.';
      $('dialog-status').classList.add('is-error');
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      state.pendingAction = null;
      return;
    }
    if (pending.mode === 'approval') {
      if (receipt.transactionHash?.toLowerCase() !== pending.hash.toLowerCase() ||
          receipt.from?.toLowerCase() !== pending.from.toLowerCase() ||
          receipt.to?.toLowerCase() !== getAsset(pending.assetId || 'usdt').address.toLowerCase() ||
          (receipt.status !== '0x1' && receipt.status !== 1)) throw new Error('Polygon receipt did not match the saved approval transaction.');
      const allowance = await ethCall(getAsset(pending.assetId || 'usdt').address, encodeAllowance(pending.from, AAVE_V3_POLYGON_POOL));
      if (allowance !== BigInt(pending.amount)) throw new Error('Receipt exists, but allowance read back did not match the exact requested amount.');
      sessionStorage.removeItem('current.pending');
      $('dialog-status').textContent = 'Exact allowance and receipt verified. Review the supply action again when ready.';
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      state.pendingAction = null;
      await refreshWallet();
      return;
    }
    const verified = await reconcilePosition(pending);
    if (!verified) throw new Error('The Polygon receipt is present, but the position has not changed by the expected amount. Status remains unverified; do not repeat the transaction.');
    sessionStorage.removeItem('current.pending');
    $('dialog-status').textContent = `Polygon receipt and updated ${getAsset(pending.assetId || 'usdt').aTokenSymbol} balance both verified.`;
    $('dialog-status').classList.remove('is-error');
    showToast('Saved transaction and updated position verified.', 'success');
    $('confirm-action').querySelector('span').textContent = 'Close';
    $('confirm-action').disabled = false;
    state.pendingAction = null;
    await refreshWallet();
    void loadSavingsGoal();
  } catch (error) {
    $('dialog-status').textContent = cleanCopy(error.message || 'Could not verify the result. Do not repeat the transaction.');
    $('dialog-status').classList.add('is-error');
    $('confirm-action').disabled = false;
  } finally {
    $('confirm-action').classList.remove('is-loading');
    $('confirm-action').removeAttribute('aria-busy');
    setBusy(false);
  }
}

function isModeAction(action) { return action && ['supply', 'withdraw'].includes(action.kind); }

async function onConfirmClick() {
  if (state.pendingAction?.kind === 'reconcile') return confirmReconciliation();
  if (!isModeAction(state.pendingAction) && !state.pendingAction) return $('review-dialog').close();
  return confirmDialogAction();
}

function maxAmount() {
  if (!state.walletData) return;
  const raw = state.mode === 'supply' ? state.walletData.tokenBalance : state.walletData.aTokenBalance;
  $('amount-input').value = formatTokenAmount(raw).replaceAll(',', '');
  updateAmountSummary();
  renderWalletControls();
  showToast('Available balance filled into the amount field.', 'info');
}

function initEvents() {
  $('connect-top').addEventListener('click', () => {
    if (!state.wallet) { state.walletDismissed = false; try { sessionStorage.removeItem('current-wallet-dismissed'); } catch {} return connectWallet(); }
    if (!state.walletData || state.walletChainId !== CHAIN_ID) return switchToPolygon();
    return refreshWallet().then(() => showToast('Wallet balances refreshed.')).catch((error) => { setWalletMessage(error.message, true); showToast(error.message, 'error'); });
  });
  $('disconnect-top').addEventListener('click', () => {
    state.wallet = null;
    state.walletData = null;
    state.savedGoals = {};
    state.walletDismissed = true;
    try { sessionStorage.setItem('current-wallet-dismissed', 'true'); } catch {}
    renderWalletHeader();
    renderWalletPosition();
    renderSavingsGoal();
    renderWalletControls();
    setWalletMessage('Disconnected from Current. Wallet permission remains managed by Nimiq Pay.');
    showToast('Disconnected from Current. Nimiq Pay still controls wallet permissions.', 'info');
  });
  $('refresh-market').addEventListener('click', () => loadMarket({ announce: true }));
  $('estimate-principal').addEventListener('input', renderYieldLens);
  $('goal-form').addEventListener('submit', saveSavingsGoal);
  $('goal-clear').addEventListener('click', clearSavingsGoal);
  $('asset-usdt').addEventListener('click', () => selectAsset('usdt'));
  $('asset-usdc').addEventListener('click', () => selectAsset('usdc'));
  $('nim-relay-button').addEventListener('click', async () => {
    if (state.busy) return;
    try {
      setBusy(true);
      $('nim-relay-button').textContent = 'Preparing NIM relay…';
      await prepareNimRelay();
    } catch (error) {
      let message = error.message || 'Could not prepare the NIM gas relay.';
      if (error.availableBalance !== undefined && state.walletData) {
        state.walletData.tokenBalance = BigInt(error.availableBalance);
        $('amount-input').value = '';
        renderWalletPosition();
        renderWalletControls();
        message = `The Worker sees ${formatTokenAmount(state.walletData.tokenBalance, currentAsset().decimals)} ${currentAsset().symbol} available. The amount was cleared; use Max or enter a lower amount and retry. No NIM was sent.`;
      }
      $('form-error').textContent = cleanCopy(message);
      $('form-error').hidden = false;
      showToast(message, 'error');
    } finally {
      $('nim-relay-button').textContent = 'Supply with NIM-paid gas';
      setBusy(false);
    }
  });
  $('permit-fallback').addEventListener('click', () => {
    if (state.pendingAction?.kind !== 'supply' || state.pendingAction.step !== 'permit') return;
    state.pendingAction.step = 'approval';
    setDialogPlan(state.pendingAction);
    showToast('Standard exact-amount approval selected. It uses an approval transaction followed by supply.', 'info');
  });
  $('tab-supply').addEventListener('click', () => setMode('supply'));
  $('tab-withdraw').addEventListener('click', () => setMode('withdraw'));
  $('amount-input').addEventListener('input', () => { updateAmountSummary(); renderWalletControls(); });
  $('amount-input').addEventListener('blur', () => { $('amount-input').value = $('amount-input').value.trim(); updateAmountSummary(); });
  $('max-button').addEventListener('click', maxAmount);
  $('action-form').addEventListener('submit', reviewSubmit);
  $('confirm-action').addEventListener('click', onConfirmClick);
  $('cancel-review').addEventListener('click', () => { state.pendingAction = null; $('review-dialog').close(); showToast('Review closed. Nothing was sent.', 'info'); });
  $('review-dialog').addEventListener('close', () => { if (state.pendingAction?.kind !== 'reconcile') state.pendingAction = null; });
  $('review-dialog').querySelector('.dialog-close-form button').addEventListener('click', () => showToast('Review closed. Nothing was sent.', 'info'));
  const injected = provider();
  void loadNimRelayStatus();
  if (injected?.on) {
    injected.on('accountsChanged', (accounts) => {
      state.walletDismissed = false;
      try { sessionStorage.removeItem('current-wallet-dismissed'); } catch {}
      state.wallet = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : null;
      state.walletData = null;
      state.savedGoals = {};
      renderWalletHeader();
      renderWalletPosition();
    renderSavingsGoal();
      renderWalletControls();
      if (state.wallet) refreshWallet().then(loadSavingsGoal).catch((error) => setWalletMessage(error.message, true));
      else setWalletMessage('Wallet disconnected.');
    });
    injected.on('chainChanged', () => {
      state.walletData = null;
      refreshWallet().then(loadSavingsGoal).catch((error) => setWalletMessage(error.message, true));
    });
  }
}

async function refreshAfterWalletReturn(snapshot, attempt = 0) {
  if (!snapshot || state.walletReturnSnapshot !== snapshot || document.hidden) return;
  if (state.busy) {
    if (attempt < 60) window.setTimeout(() => refreshAfterWalletReturn(snapshot, attempt + 1), 500);
    return;
  }
  state.walletReturnSnapshot = null;
  if (!state.wallet || snapshot.wallet?.toLowerCase() !== state.wallet.toLowerCase()) return;
  try {
    await refreshWallet();
    if (!state.walletData || state.mode !== snapshot.mode) return;
    const supplyCompleted = snapshot.mode === 'supply' &&
      snapshot.tokenBalance - state.walletData.tokenBalance >= snapshot.amount &&
      expectedBalanceDelta(snapshot.aTokenBalance, state.walletData.aTokenBalance, snapshot.amount, 'supply');
    const withdrawalCompleted = snapshot.mode === 'withdraw' &&
      state.walletData.tokenBalance - snapshot.tokenBalance >= snapshot.amount &&
      expectedBalanceDelta(snapshot.aTokenBalance, state.walletData.aTokenBalance, snapshot.amount, 'withdraw');
    if (supplyCompleted || withdrawalCompleted) {
      const label = snapshot.mode === 'supply' ? 'Supply' : 'Withdrawal';
      $('amount-input').value = '';
      try { sessionStorage.removeItem('current.pending'); } catch {}
      state.pendingAction = null;
      updateAmountSummary();
      renderWalletControls();
      if ($('review-dialog').open) {
        $('dialog-status').textContent = `${label} detected and verified from your updated Polygon balances. No second transaction is needed.`;
        $('dialog-status').classList.remove('is-error');
        $('confirm-action').querySelector('span').textContent = 'Close';
        $('confirm-action').disabled = false;
      }
      setWalletMessage(`${label} detected. Your refreshed Polygon balances confirm the transaction.`);
      showToast(`${label} detected and verified from your updated Polygon balances.`, 'success');
    }
  } catch (error) { setWalletMessage(error.message || 'Could not refresh your Polygon balance.', true); }
}
async function init() {
  initMobilePages();
  initEvents();
  renderWalletControls();
  renderSavingsGoal();
  void loadNairaRate();
  const pending = savedPending();
  if (pending) {
    $('position-status').textContent = 'A prior transaction needs reconciliation';
    $('position-status').style.color = 'var(--red)';
  }
  await loadMarket();
  restoreRelayStatus();
  window.setInterval(() => {
    if (document.hidden) return;
    const stale = state.market && Date.now() - state.market.fetchedAt.getTime() >= 60_000;
    if (stale) {
      $('market-state').className = 'live-badge is-error';
      $('market-state').innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Data stale</span>';
      $('market-data-note').textContent = 'Last Aave response is stale';
      $('reserve-status').textContent = 'Last known state · not current';
      $('freshness').textContent = 'This rate is more than 60 seconds old. Refreshing before it can be used.';
      renderWalletControls();
    }
    if (!state.market || stale) loadMarket();
  }, 15_000);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      if (state.walletData && ['supply', 'withdraw'].includes(state.mode)) {
        try {
          state.walletReturnSnapshot = {
            wallet: state.wallet,
            mode: state.mode,
            amount: parseTokenAmount($('amount-input').value),
            tokenBalance: state.walletData.tokenBalance,
            aTokenBalance: state.walletData.aTokenBalance,
          };
        } catch { state.walletReturnSnapshot = null; }
      }
      return;
    }
    if (!state.market || Date.now() - state.market.fetchedAt.getTime() >= 60_000) loadMarket();
    const snapshot = state.walletReturnSnapshot;
    if (snapshot) void refreshAfterWalletReturn(snapshot);
  });
  const injected = provider();
  if (injected && !state.walletDismissed) {
    try {
      const accounts = await injected.request({ method: 'eth_accounts' });
      if (Array.isArray(accounts) && isAddress(accounts[0])) {
        state.wallet = accounts[0];
        renderWalletHeader();
        await refreshWallet();
        void loadSavingsGoal();
        await reconcileSavedPending();
      }
    } catch (error) { setWalletMessage(error.message || 'Could not read wallet state.', true); }
  }
}

function initMobilePages() {
  const nav = document.querySelector('.mobile-tabbar');
  if (!nav) return;
  const buttons = [...nav.querySelectorAll('[data-mobile-page]')];
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      document.body.dataset.mobilePage = button.dataset.mobilePage;
      buttons.forEach((item) => {
        if (item === button) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      window.scrollTo(0, 0);
    });
  });
}

init().catch((error) => {
  $('market-error').textContent = cleanCopy(error.message || 'Current could not start.');
  $('market-error').hidden = false;
});
