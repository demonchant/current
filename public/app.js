import {
  AAVE_GRAPHQL,
  AAVE_V3_POLYGON_ATOKEN,
  AAVE_V3_POLYGON_POOL,
  CHAIN_ID,
  POLYGON_HEX_CHAIN_ID,
  TOKEN_DECIMALS,
  USDT_ADDRESS,
  amountFromInput,
  encodeAllowance,
  encodeBalanceOf,
  estimateSimpleYield,
  expectedBalanceDelta,
  formatTokenAmount,
  isAddress,
  parseTokenAmount,
  prepareExactApprovalTransaction,
  validateApprovalTransaction,
  validateSupplyTransaction,
  validateWithdrawTransaction,
} from './domain.mjs';

const $ = (id) => document.getElementById(id);
const cleanCopy = (value) => String(value ?? '').replace(/-/g, ' ');
const RATE_HISTORY_KEY = 'current.apy-history.v1';
function wasWalletDismissed() { try { return sessionStorage.getItem('current-wallet-dismissed') === 'true'; } catch { return false; } }
const state = {
  market: null,
  wallet: null,
  walletData: null,
  walletDismissed: wasWalletDismissed(),
  mode: 'supply',
  gqlBusy: false,
  pendingAction: null,
  busy: false,
  toastTimer: null,
};

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

function findUsdtReserve(market) {
  if (!market || market.address?.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() || Number(market.chain?.chainId) !== CHAIN_ID) {
    throw new Error('Aave V3 Polygon did not match the verified market address. Transactions are disabled.');
  }
  const reserve = market.reserves?.find((item) => item.underlyingToken?.address?.toLowerCase() === USDT_ADDRESS.toLowerCase());
  if (!reserve || Number(reserve.underlyingToken.decimals) !== TOKEN_DECIMALS ||
      reserve.aToken?.address?.toLowerCase() !== AAVE_V3_POLYGON_ATOKEN.toLowerCase()) {
    throw new Error('The live Aave USDT reserve did not match the verified Polygon USDT and aUSDT contracts. Transactions are disabled.');
  }
  return reserve;
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
    const reserve = findUsdtReserve(market);
    state.market = { ...market, reserve, fetchedAt: new Date() };
    recordRateSnapshot(Number(reserve.supplyInfo?.apy?.formatted));
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
  window.dispatchEvent(new CustomEvent('current:rate', { detail: { value: `${rate}%`, source: 'Current Aave market rate' } }));
  $('market-error').hidden = true;
  renderRateHistory(rate);
  renderWalletControls();
  renderYieldLens();
}

function readRateHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RATE_HISTORY_KEY) || '[]');
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
    localStorage.setItem(RATE_HISTORY_KEY, JSON.stringify(history.filter((entry) => entry.t >= cutoff).slice(-720)));
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

function renderYieldLens() {
  const input = $('estimate-principal');
  if (!marketIsFresh()) {
    input.disabled = true;
    $('estimate-30').textContent = '—';
    $('estimate-365').textContent = '—';
    $('yield-estimate-status').textContent = state.gqlBusy ? 'Refreshing the live Aave rate…' : 'A live Aave rate is required before estimating.';
    return;
  }
  input.disabled = false;
  const amount = input.value.trim();
  if (!amount) {
    $('estimate-30').textContent = '—';
    $('estimate-365').textContent = '—';
    $('yield-estimate-status').textContent = `Using the current ${state.market.reserve.supplyInfo.apy.formatted}% Aave supply APY when you enter an amount.`;
    return;
  }
  try {
    const principal = parseTokenAmount(amount);
    const apy = state.market.reserve.supplyInfo.apy.formatted;
    $('estimate-30').textContent = `${formatTokenAmount(estimateSimpleYield(principal, apy, 30))} USDT`;
    $('estimate-365').textContent = `${formatTokenAmount(estimateSimpleYield(principal, apy, 365))} USDT`;
    $('yield-estimate-status').textContent = `Illustrative gross estimate at the live ${apy}% APY, fetched with the Aave market data above.`;
  } catch (error) {
    $('estimate-30').textContent = '—';
    $('estimate-365').textContent = '—';
    $('yield-estimate-status').textContent = cleanCopy(error.message);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function provider() {
  return window.ethereum && typeof window.ethereum.request === 'function' ? window.ethereum : null;
}

function setWalletMessage(message, error = false) {
  $('position-status').textContent = cleanCopy(message);
  $('position-status').style.color = error ? 'var(--red)' : '';
}

function shortAddress(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

async function connectWallet() {
  const injected = provider();
  if (!injected) {
    setWalletMessage('Open this Mini App inside Nimiq Pay to connect.', true);
    showToast('Wallet connection is available inside Nimiq Pay. No wallet was connected.', 'error');
    return;
  }
  setBusy(true);
  try {
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !isAddress(accounts[0])) throw new Error('Nimiq Pay did not return a valid EVM account.');
    state.wallet = accounts[0];
    const chain = await injected.request({ method: 'eth_chainId' });
    renderWalletHeader();
    if (Number.parseInt(chain, 16) !== CHAIN_ID) {
      state.walletData = null;
      setWalletMessage('Switch to Polygon to read this position.');
      $('gas-balance').textContent = 'Switch network to check';
      renderWalletControls();
      showToast('Switch to Polygon to view your position.', 'info');
      return;
    }
    await refreshWallet();
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

async function switchToPolygon() {
  const injected = provider();
  if (!injected) return connectWallet();
  setBusy(true);
  try {
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_HEX_CHAIN_ID }] });
    const chain = await injected.request({ method: 'eth_chainId' });
    if (Number.parseInt(chain, 16) !== CHAIN_ID) throw new Error('The wallet is still on a different network.');
    await refreshWallet();
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

async function ethCall(to, data) {
  const injected = provider();
  if (!injected) throw new Error('Open this Mini App inside Nimiq Pay to read your wallet.');
  const result = await injected.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('The Polygon provider returned an invalid read result.');
  return BigInt(result);
}

async function refreshWallet() {
  const injected = provider();
  if (!injected || !state.wallet) return;
  const [accounts, chain] = await Promise.all([
    injected.request({ method: 'eth_accounts' }),
    injected.request({ method: 'eth_chainId' }),
  ]);
  if (!Array.isArray(accounts) || !accounts[0] || accounts[0].toLowerCase() !== state.wallet.toLowerCase()) {
    state.wallet = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : null;
    state.walletData = null;
    renderWalletHeader();
    renderWalletControls();
    setWalletMessage('Wallet account changed. Refresh the position before continuing.');
    return;
  }
  if (Number.parseInt(chain, 16) !== CHAIN_ID) {
    state.walletData = null;
    $('gas-balance').textContent = 'Switch network to check';
    setWalletMessage('Switch to Polygon to read this position.');
    renderWalletControls();
    return;
  }
  if (!state.market) {
    state.walletData = null;
    $('gas-balance').textContent = 'Market data unavailable';
    renderWalletControls();
    return;
  }
  const [tokenBalance, aTokenBalance, allowance, nativeBalance, scaledBalance] = await Promise.all([
    ethCall(USDT_ADDRESS, encodeBalanceOf(state.wallet)),
    ethCall(AAVE_V3_POLYGON_ATOKEN, encodeBalanceOf(state.wallet)),
    ethCall(USDT_ADDRESS, encodeAllowance(state.wallet, AAVE_V3_POLYGON_POOL)),
    injected.request({ method: 'eth_getBalance', params: [state.wallet, 'latest'] }).then(BigInt),
    ethCall(AAVE_V3_POLYGON_ATOKEN, `0x1da24f3e${state.wallet.slice(2).toLowerCase().padStart(64, '0')}`).catch(() => null),
  ]);
  state.walletData = { tokenBalance, aTokenBalance, allowance, nativeBalance, scaledBalance, fetchedAt: new Date() };
  renderWalletHeader();
  renderWalletPosition();
  $('gas-balance').textContent = `${formatTokenAmount(nativeBalance, 18, 5)} POL`;
  $('available-label').textContent = state.mode === 'supply' ? `${formatTokenAmount(tokenBalance)} USDT available` : `${formatTokenAmount(aTokenBalance)} USDT supplied`;
  setWalletMessage('Position read directly from Polygon');
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
  if (!state.walletData) {
    $('position-value').textContent = state.wallet ? 'Waiting for Polygon' : 'Connect your wallet';
    $('position-value').classList.remove('has-value');
    $('position-principal').textContent = '—';
    $('position-interest').textContent = '—';
    $('position-refreshed').textContent = 'Position not refreshed';
    return;
  }
  $('position-value').textContent = `${formatTokenAmount(state.walletData.aTokenBalance)} USDT`;
  $('position-value').classList.add('has-value');
  if (state.walletData.scaledBalance !== null) {
    const interest = state.walletData.aTokenBalance > state.walletData.scaledBalance
      ? state.walletData.aTokenBalance - state.walletData.scaledBalance : 0n;
    $('position-principal').textContent = `${formatTokenAmount(state.walletData.scaledBalance)} USDT`;
    $('position-interest').textContent = `${formatTokenAmount(interest)} USDT`;
  } else {
    $('position-principal').textContent = 'Unavailable';
    $('position-interest').textContent = 'Unavailable';
  }
  $('position-refreshed').textContent = `Last position refresh · ${state.walletData.fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function marketIsFresh() {
  return Boolean(state.market && Date.now() - state.market.fetchedAt.getTime() < 60_000 && !state.gqlBusy);
}

function marketAllowsSupply() {
  const reserve = state.market?.reserve;
  return Boolean(marketIsFresh() && !reserve.isPaused && !reserve.isFrozen && !reserve.supplyInfo?.supplyCapReached);
}

function renderWalletControls() {
  const connected = Boolean(state.wallet);
  const onPolygon = connected && state.walletData !== null;
  const marketFresh = marketIsFresh();
  const actionAvailable = state.mode === 'supply' ? marketAllowsSupply() : marketFresh;
  const input = $('amount-input');
  input.disabled = !onPolygon || state.busy || !actionAvailable;
  $('max-button').disabled = !onPolygon || state.busy || !actionAvailable;
  $('tab-withdraw').disabled = !onPolygon || BigInt(state.walletData?.aTokenBalance ?? 0) === 0n || state.busy;
  $('tab-supply').disabled = state.busy;
  const hasAmount = validAmountForCurrentMode();
  const canWrite = onPolygon && actionAvailable && hasAmount && BigInt(state.walletData?.nativeBalance ?? 0) > 0n && !state.busy;
  $('review-button').disabled = !canWrite;
  $('connect-top').disabled = state.busy;
  $('disconnect-top').disabled = state.busy;
  if (!connected) $('primary-label').textContent = 'Connect wallet';
  else if (!state.walletData) $('primary-label').textContent = 'Switch to Polygon';
  else if (!actionAvailable) $('primary-label').textContent = state.mode === 'supply' && marketFresh ? 'Supply unavailable' : 'Market unavailable';
  else if (BigInt(state.walletData.nativeBalance) === 0n) $('primary-label').textContent = 'POL needed for gas';
  else $('primary-label').textContent = state.mode === 'supply' ? 'Review supply' : 'Review withdrawal';
  $('action-caption').textContent = !connected
    ? 'Open this Mini App in Nimiq Pay to connect a wallet.'
    : !state.walletData ? 'Switch to Polygon before reading your position.'
      : BigInt(state.walletData.nativeBalance) === 0n ? 'Add POL to your Polygon wallet before a transaction.'
        : 'Your wallet will show each transaction for approval.';
  updateAmountSummary();
}

function validAmountForCurrentMode() {
  if (!state.walletData || !state.market) return false;
  try {
    amountFromInput($('amount-input').value, state.mode, state.walletData.tokenBalance, state.walletData.aTokenBalance);
    return true;
  } catch { return false; }
}

function updateAmountSummary() {
  const label = state.mode === 'supply' ? 'Amount to supply' : 'Amount to withdraw';
  $('amount-label').textContent = label;
  $('summary-label').textContent = state.mode === 'supply' ? 'You supply' : 'You withdraw';
  $('summary-value').textContent = 'Enter an amount';
  $('approval-summary').textContent = state.mode === 'supply' ? 'Shown before signing' : 'Not required';
  $('amount-input').placeholder = state.mode === 'supply' ? '0.00' : '0.00';
  if (state.walletData && $('amount-input').value.trim()) {
    try {
      const raw = amountFromInput($('amount-input').value, state.mode, state.walletData.tokenBalance, state.walletData.aTokenBalance);
      $('summary-value').textContent = `${formatTokenAmount(raw)} USDT`;
      $('form-error').hidden = true;
    } catch (error) {
      $('form-error').textContent = cleanCopy(error.message);
      $('form-error').hidden = false;
    }
  } else $('form-error').hidden = true;
  $('available-label').textContent = state.walletData
    ? `${formatTokenAmount(state.mode === 'supply' ? state.walletData.tokenBalance : state.walletData.aTokenBalance)} USDT ${state.mode === 'supply' ? 'available' : 'supplied'}`
    : 'Balance unavailable';
  const enough = validAmountForCurrentMode();
  const marketAvailable = state.mode === 'supply' ? marketAllowsSupply() : marketIsFresh();
  $('review-button').disabled = !enough || !state.walletData || state.busy || !marketAvailable || BigInt(state.walletData?.nativeBalance ?? 0) === 0n;
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

function makeSupplyQuery(amount) {
  const amountText = formatTokenAmount(amount).replaceAll(',', '');
  return `query { supply(request: { market: "${AAVE_V3_POLYGON_POOL}", amount: { erc20: { currency: "${USDT_ADDRESS}", value: "${amountText}" } }, sender: "${state.wallet}", chainId: ${CHAIN_ID} }) {
    __typename
    ... on TransactionRequest { to from data value chainId operation }
    ... on ApprovalRequired { reason requiredAmount { value decimals } currentAllowance { value decimals } approval { to from data value chainId operation } originalTransaction { to from data value chainId operation } }
    ... on InsufficientBalanceError { required { value decimals } available { value decimals } }
  } }`;
}

function makeWithdrawQuery(amount) {
  const amountText = formatTokenAmount(amount).replaceAll(',', '');
  return `query { withdraw(request: { market: "${AAVE_V3_POLYGON_POOL}", amount: { erc20: { currency: "${USDT_ADDRESS}", value: { exact: "${amountText}" } } }, sender: "${state.wallet}", chainId: ${CHAIN_ID} }) {
    __typename
    ... on TransactionRequest { to from data value chainId operation }
    ... on ApprovalRequired { reason requiredAmount { value decimals } currentAllowance { value decimals } approval { to from data value chainId operation } originalTransaction { to from data value chainId operation } }
    ... on InsufficientBalanceError { required { value decimals } available { value decimals } }
  } }`;
}

async function prepareAction(amount) {
  const response = await gql(state.mode === 'supply' ? makeSupplyQuery(amount) : makeWithdrawQuery(amount));
  const plan = response[state.mode];
  if (!plan) throw new Error('Aave did not return a transaction plan. Nothing was sent.');
  if (plan.__typename === 'InsufficientBalanceError') throw new Error(`Aave reports insufficient balance. Available: ${plan.available?.value ?? 'unavailable'} USDT.`);
  if (state.mode === 'supply') {
    if (plan.__typename === 'ApprovalRequired') {
      validateSupplyTransaction(plan.originalTransaction, state.wallet, amount);
      const exactApproval = prepareExactApprovalTransaction(plan.approval, state.wallet, amount, state.walletData.allowance);
      validateApprovalTransaction(exactApproval, state.wallet, amount);
      return { kind: 'supply', amount, plan: { ...plan, approval: exactApproval }, step: 'approval' };
    }
    if (plan.__typename === 'TransactionRequest') {
      validateSupplyTransaction(plan, state.wallet, amount);
      return { kind: 'supply', amount, plan, step: 'supply' };
    }
  } else if (plan.__typename === 'TransactionRequest') {
    validateWithdrawTransaction(plan, state.wallet, amount);
    return { kind: 'withdraw', amount, plan, step: 'withdraw' };
  }
  throw new Error(`Aave returned an unsupported ${plan.__typename || 'transaction'} plan. Nothing was sent.`);
}

function setDialogPlan(action) {
  state.pendingAction = action;
  const needsApproval = action.kind === 'supply' && action.step === 'approval';
  $('dialog-action').textContent = needsApproval ? 'Approve exact spend' : action.kind === 'supply' ? 'Supply to Aave' : 'Withdraw from Aave';
  $('dialog-amount').textContent = `${formatTokenAmount(action.amount)} USDT`;
  $('transaction-target').textContent = needsApproval
    ? `USDT token · ${USDT_ADDRESS}`
    : `Aave V3 pool · ${AAVE_V3_POLYGON_POOL}`;
  $('approval-detail-row').hidden = !needsApproval;
  $('approval-detail').textContent = `${formatTokenAmount(action.amount)} USDT · one-time exact amount`;
  $('dialog-status').textContent = needsApproval
    ? 'Aave requests a one-time approval limited to this exact amount. The supply requires a separate confirmation afterward.'
    : action.kind === 'supply' ? 'The next wallet prompt will supply this exact amount to the verified Aave V3 Polygon pool.' : 'The next wallet prompt will withdraw this exact amount to your connected wallet.';
  $('dialog-status').classList.remove('is-error');
  $('confirm-action').disabled = false;
  $('confirm-action').querySelector('span').textContent = needsApproval ? 'Approve in wallet' : 'Continue to wallet';
  $('transaction-link').hidden = true;
  if (!$('review-dialog').open) $('review-dialog').showModal();
}

async function reviewSubmit(event) {
  event.preventDefault();
  if (!state.wallet) return connectWallet();
  if (!state.walletData) return switchToPolygon();
  if (!state.market || state.gqlBusy || Date.now() - state.market.fetchedAt.getTime() >= 60_000) return showToast('Live Aave market data is unavailable or out of date. Refresh it before preparing a transaction.');
  try {
    const amount = amountFromInput($('amount-input').value, state.mode, state.walletData.tokenBalance, state.walletData.aTokenBalance);
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
  if (Number.parseInt(chain, 16) !== CHAIN_ID) throw new Error('Wallet network changed. Switch back to Polygon and review again.');
}

async function sendValidated(transaction, kind, amount) {
  const injected = provider();
  await recheckBeforeWrite();
  if (kind === 'approval') validateApprovalTransaction(transaction, state.wallet, amount);
  if (kind === 'supply') validateSupplyTransaction(transaction, state.wallet, amount);
  if (kind === 'withdraw') validateWithdrawTransaction(transaction, state.wallet, amount);
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
  setBusy(true);
  $('confirm-action').disabled = true;
  $('confirm-action').classList.add('is-loading');
  $('confirm-action').setAttribute('aria-busy', 'true');
  try {
    if (!state.market || state.gqlBusy || Date.now() - state.market.fetchedAt.getTime() >= 60_000) {
      state.pendingAction = null;
      $('dialog-status').textContent = 'Live Aave market data expired while you reviewed this action. Refresh the market and prepare the transaction again; nothing was sent.';
      $('dialog-status').classList.add('is-error');
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      return;
    }
    await recheckBeforeWrite();
    if (action.step === 'approval') {
      const hash = await sendValidated(action.plan.approval, 'approval', action.amount);
      const pending = { hash, mode: 'approval', from: state.wallet, amount: action.amount.toString(), before: null };
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
      if (receipt.from?.toLowerCase() !== state.wallet.toLowerCase() || receipt.to?.toLowerCase() !== USDT_ADDRESS.toLowerCase()) {
        throw new Error('Polygon receipt did not match the approved wallet and USDT token contract. Reconcile before continuing.');
      }
      const allowance = await ethCall(USDT_ADDRESS, encodeAllowance(state.wallet, AAVE_V3_POLYGON_POOL));
      if (allowance !== action.amount) throw new Error('Approval receipt confirmed, but Polygon read back did not show the exact requested allowance. Supply remains disabled.');
      sessionStorage.removeItem('current.pending');
      state.pendingAction = null;
      $('confirm-action').querySelector('span').textContent = 'Close';
      $('confirm-action').disabled = false;
      // Rebuild the Aave plan after allowance confirmation so the wallet gets
      // a fresh supply call, never a stale approval plan.
      const refreshedPlan = await gql(makeSupplyQuery(action.amount));
      const supplyPlan = refreshedPlan.supply;
      if (!supplyPlan || supplyPlan.__typename !== 'TransactionRequest') {
        throw new Error('Approval confirmed, but Aave did not return a separate supply transaction. Refresh and review again.');
      }
      validateSupplyTransaction(supplyPlan, state.wallet, action.amount);
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
    const before = await ethCall(AAVE_V3_POLYGON_ATOKEN, encodeBalanceOf(state.wallet));
    const transaction = action.step === 'supply' ? action.plan.originalTransaction || action.plan : action.plan;
    const hash = await sendValidated(transaction, mode, action.amount);
    const pending = { hash, mode, from: state.wallet, amount: action.amount.toString(), before: before.toString() };
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
    const verified = await reconcilePosition({ hash, mode, from: state.wallet, amount: action.amount.toString(), before: before.toString() });
    if (verified) {
      sessionStorage.removeItem('current.pending');
      $('dialog-status').textContent = `${mode === 'supply' ? 'Supply' : 'Withdrawal'} confirmed. Polygon receipt and updated aUSDT balance both verified.`;
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
    $('dialog-status').textContent = cleanCopy(isUserRejected(error) ? 'Wallet request declined. No success was recorded.' : (error.message || 'Transaction failed. No success was recorded.'));
    $('dialog-status').classList.add('is-error');
    showToast(isUserRejected(error) ? 'Wallet request declined. Nothing was completed.' : (error.message || 'Transaction failed.'), 'error');
    $('confirm-action').disabled = false;
  } finally {
    $('confirm-action').classList.remove('is-loading');
    $('confirm-action').removeAttribute('aria-busy');
    setBusy(false);
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

async function reconcilePosition({ hash, mode, from, amount, before }) {
  if (!provider() || state.wallet?.toLowerCase() !== from.toLowerCase()) return false;
  const receipt = await provider().request({ method: 'eth_getTransactionReceipt', params: [hash] });
  if (!receipt || (receipt.status !== '0x1' && receipt.status !== 1) ||
      receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
      receipt.from?.toLowerCase() !== from.toLowerCase() ||
      receipt.to?.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase()) return false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const after = await ethCall(AAVE_V3_POLYGON_ATOKEN, encodeBalanceOf(from));
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
  $('dialog-amount').textContent = pending.amount ? `${formatTokenAmount(pending.amount)} USDT` : 'Approval';
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
          receipt.to?.toLowerCase() !== USDT_ADDRESS.toLowerCase() ||
          (receipt.status !== '0x1' && receipt.status !== 1)) throw new Error('Polygon receipt did not match the saved approval transaction.');
      const allowance = await ethCall(USDT_ADDRESS, encodeAllowance(pending.from, AAVE_V3_POLYGON_POOL));
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
    $('dialog-status').textContent = 'Polygon receipt and updated aUSDT balance both verified.';
    $('dialog-status').classList.remove('is-error');
    showToast('Saved transaction and updated position verified.', 'success');
    $('confirm-action').querySelector('span').textContent = 'Close';
    $('confirm-action').disabled = false;
    state.pendingAction = null;
    await refreshWallet();
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
    if (!state.walletData) return switchToPolygon();
    return refreshWallet().then(() => showToast('Wallet balances refreshed.')).catch((error) => { setWalletMessage(error.message, true); showToast(error.message, 'error'); });
  });
  $('disconnect-top').addEventListener('click', () => {
    state.wallet = null;
    state.walletData = null;
    state.walletDismissed = true;
    try { sessionStorage.setItem('current-wallet-dismissed', 'true'); } catch {}
    renderWalletHeader();
    renderWalletPosition();
    renderWalletControls();
    setWalletMessage('Disconnected from Current. Wallet permission remains managed by Nimiq Pay.');
    showToast('Disconnected from Current. Nimiq Pay still controls wallet permissions.', 'info');
  });
  $('refresh-market').addEventListener('click', () => loadMarket({ announce: true }));
  $('estimate-principal').addEventListener('input', renderYieldLens);
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
  if (injected?.on) {
    injected.on('accountsChanged', (accounts) => {
      state.walletDismissed = false;
      try { sessionStorage.removeItem('current-wallet-dismissed'); } catch {}
      state.wallet = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : null;
      state.walletData = null;
      renderWalletHeader();
      renderWalletPosition();
      renderWalletControls();
      if (state.wallet) refreshWallet().catch((error) => setWalletMessage(error.message, true));
      else setWalletMessage('Wallet disconnected.');
    });
    injected.on('chainChanged', () => {
      state.walletData = null;
      refreshWallet().catch((error) => setWalletMessage(error.message, true));
    });
  }
}

async function init() {
  initEvents();
  renderWalletControls();
  const pending = savedPending();
  if (pending) {
    $('position-status').textContent = 'A prior transaction needs reconciliation';
    $('position-status').style.color = 'var(--red)';
  }
  await loadMarket();
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!state.market || Date.now() - state.market.fetchedAt.getTime() >= 60_000)) loadMarket();
  });
  const injected = provider();
  if (injected && !state.walletDismissed) {
    try {
      const accounts = await injected.request({ method: 'eth_accounts' });
      if (Array.isArray(accounts) && isAddress(accounts[0])) {
        state.wallet = accounts[0];
        renderWalletHeader();
        await refreshWallet();
        await reconcileSavedPending();
      }
    } catch (error) { setWalletMessage(error.message || 'Could not read wallet state.', true); }
  }
}

init().catch((error) => {
  $('market-error').textContent = cleanCopy(error.message || 'Current could not start.');
  $('market-error').hidden = false;
});
