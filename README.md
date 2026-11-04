# Current

An **Earn** Mini App for Nimiq Pay. Current is designed to show the live Aave V3 USDT supply rate on Polygon, display a user's Aave position, and let them supply or withdraw USDT from their Nimiq Pay wallet. It does not hold funds or promise returns.

## Status

This repository contains the product code, but the live Aave API, Nimiq Pay wallet flow, real Polygon supply/withdrawal, hosted deployment, and browser suite have not yet been verified. The application is not ready for funded use or hackathon submission. Do not present it as live until those flows have been verified end to end.

## Run locally

Requires Node.js 24 or later. No `.env` file or runtime package installation is required.

```powershell
npm run dev
```

Open `http://localhost:4173` in a browser. To load it inside Nimiq Pay on a phone on the same Wi-Fi, use the development machine's LAN IP and port `4173` in Mini Apps → Custom URL. Outside Nimiq Pay, no wallet is injected, so the wallet connection and transaction controls remain unavailable.

The product targets Polygon mainnet (chain ID 137). A supply or withdrawal uses real USDT and real POL gas. The Nimiq testnet switch does not make EVM Mini App transactions testnet transactions.

## Product flow

1. Load the current Aave V3 Polygon USDT market data.
2. Connect the Nimiq Pay EVM wallet and read its Polygon USDT, POL, and aUSDT balances.
3. Prepare and validate an exact Aave transaction; show its target and amount before wallet confirmation.
4. Show completion only after a successful Polygon receipt and independent position read-back.

When the Aave API or wallet is unavailable, the app should show that state and prevent the corresponding action. A transaction hash alone is not completion.

## Checks

```powershell
npm test
```

The Playwright browser suite is available with `npm run e2e` once `@playwright/test` is installed. It has not been run in this environment. Docker Compose configuration is provided for containerized browser testing; the Docker engine was unavailable here.

## Competition

The selected category is **Earn** for Nimiq Mini Apps Competition Cycle III. Cycle III defines Earn as putting funds to work through staking or yield. The public source is intended to be released under the MIT License.
