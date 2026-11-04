import {
  AAVE_GRAPHQL,
  AAVE_V3_POLYGON_ATOKEN,
  AAVE_V3_POLYGON_POOL,
  CHAIN_ID,
  TOKEN_DECIMALS,
  USDT_ADDRESS,
} from './domain.mjs';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function showRate(value, source) {
  document.querySelectorAll('[data-live-apy]').forEach((node) => { node.textContent = value; });
  document.querySelectorAll('[data-rate-source]').forEach((node) => { node.textContent = source; });
}

async function loadLandingRate() {
  const query = `query { market(request: { address: "${AAVE_V3_POLYGON_POOL}", chainId: ${CHAIN_ID} }) { address chain { chainId } reserves(request: { reserveType: SUPPLY }) { underlyingToken { address decimals } aToken { address } supplyInfo { apy { formatted } } } } }`;
  try {
    const response = await fetch(AAVE_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error('Market data is unavailable');
    const body = await response.json();
    if (body.errors?.length) throw new Error('Market data is unavailable');
    const market = body.data?.market;
    const reserve = market?.reserves?.find((item) => item.underlyingToken?.address?.toLowerCase() === USDT_ADDRESS.toLowerCase());
    const rate = reserve?.supplyInfo?.apy?.formatted;
    if (market?.address?.toLowerCase() !== AAVE_V3_POLYGON_POOL.toLowerCase() || Number(market?.chain?.chainId) !== CHAIN_ID ||
        Number(reserve?.underlyingToken?.decimals) !== TOKEN_DECIMALS || reserve?.aToken?.address?.toLowerCase() !== AAVE_V3_POLYGON_ATOKEN.toLowerCase() ||
        typeof rate !== 'string' || !/^\d+(?:\.\d+)?$/.test(rate)) throw new Error('Market data is unavailable');
    const checkedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    showRate(`${rate}%`, `Aave market · checked ${checkedAt}`);
  } catch {
    showRate('Unavailable', 'A live Aave rate could not be read');
  }
}

function initCarousel() {
  const carousel = document.querySelector('[data-carousel]');
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll('[data-slide]')];
  const dots = [...carousel.querySelectorAll('[data-carousel-dot]')];
  const progress = carousel.querySelector('[data-carousel-progress]');
  const pauseButton = carousel.querySelector('[data-carousel-toggle]');
  let active = 0;
  let timer;
  let paused = reducedMotion.matches;

  slides.forEach((slide) => {
    const image = slide.querySelector('.story-image');
    image?.addEventListener('error', () => slide.classList.add('image-unavailable'), { once: true });
  });

  function paint(index) {
    active = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === active);
      slide.setAttribute('aria-hidden', String(i !== active));
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === active);
      if (i === active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    if (progress) {
      progress.classList.remove('is-running');
      void progress.offsetWidth;
      if (!paused && !reducedMotion.matches) progress.classList.add('is-running');
    }
  }

  function stop() { window.clearInterval(timer); timer = undefined; }
  function start() {
    stop();
    if (paused || reducedMotion.matches) return;
    paint(active);
    timer = window.setInterval(() => paint(active + 1), 20_000);
  }

  carousel.querySelector('[data-carousel-prev]')?.addEventListener('click', () => { paint(active - 1); start(); });
  carousel.querySelector('[data-carousel-next]')?.addEventListener('click', () => { paint(active + 1); start(); });
  dots.forEach((dot, i) => dot.addEventListener('click', () => { paint(i); start(); }));
  pauseButton?.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? '▶' : 'Ⅱ';
    pauseButton.setAttribute('aria-label', paused ? 'Resume story rotation' : 'Pause story rotation');
    start();
  });
  carousel.addEventListener('pointerenter', stop);
  carousel.addEventListener('pointerleave', start);
  carousel.addEventListener('focusin', stop);
  carousel.addEventListener('focusout', (event) => { if (!carousel.contains(event.relatedTarget)) start(); });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  reducedMotion.addEventListener('change', () => start());
  paint(0);
  start();
}

function initBlooms() {
  const layer = document.querySelector('[data-bloom]');
  if (!layer || reducedMotion.matches) return;
  let live = 0;
  const sprout = () => {
    if (document.hidden || live >= 4) return;
    live += 1;
    const bloom = document.createElement('span');
    bloom.className = 'floating-bloom';
    bloom.setAttribute('aria-hidden', 'true');
    const x = Math.floor(Math.random() * 10);
    const y = Math.floor(Math.random() * 9);
    const color = Math.floor(Math.random() * petalColors.length);
    bloom.classList.add(`bloom-x-${x}`, `bloom-y-${y}`, `bloom-color-${color}`);
    for (let index = 0; index < 5; index += 1) {
      const petal = document.createElement('i');
      petal.className = `petal-${index}`;
      bloom.append(petal);
    }
    const heart = document.createElement('b');
    bloom.append(heart);
    layer.append(bloom);
    window.setTimeout(() => { bloom.remove(); live -= 1; }, 3300);
  };
  const schedule = () => window.setTimeout(() => { sprout(); schedule(); }, 3200 + Math.random() * 3900);
  window.setTimeout(schedule, 1200);
}

initCarousel();
initBlooms();
if (document.body.classList.contains('landing')) {
  loadLandingRate();
  window.setInterval(() => { if (!document.hidden) loadLandingRate(); }, 45_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLandingRate(); });
}
window.addEventListener('current:rate', (event) => {
  const detail = event.detail;
  if (detail?.value) showRate(detail.value, detail.source || 'Current Aave market rate');
  else if (detail?.error) showRate('Unavailable', 'A live Aave rate could not be read');
});
