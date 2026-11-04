# Current

**A Nimiq Pay Mini App for supplying and withdrawing USDT with Aave V3 on Polygon.** Current puts the market view, your position, and transaction review in one focused experience.

> **Use with care:** This targets Polygon mainnet. Real actions require USDT and POL for gas. Aave yield varies and is not guaranteed. Review protocol and asset risks before signing.

## What it does

- Reads Aave USDT market data and shows the user’s Polygon position.
- Connects through the wallet provider available inside Nimiq Pay.
- Prepares supply and withdrawal transactions for the user to review and sign.
- Checks the Polygon receipt and position read-back before reporting completion.

Current does not take custody of funds. It is an interface to Aave, not a guarantee of returns.

## Try it

Open the deployed URL inside Nimiq Pay, or run locally with Node.js 24 or later:

```sh
npm run dev
```

Then visit `http://localhost:4173` for the project overview or `http://localhost:4173/app` for the app. No environment file is needed. A normal browser can show the interface, but wallet actions require Nimiq Pay’s injected EVM wallet.

## Network and costs

The app is configured for **Polygon mainnet (chain ID 137)** and Polygon USDT. The Nimiq testnet switch does not change the EVM network. A supply may first require a token approval, and both approval and supply/withdrawal can require POL gas. Check the wallet’s network, recipient/contract details, amount, and fee before signing.

## Competition fit

Current is designed for the **Earn** category of the Nimiq Mini Apps Competition: a user can put USDT to work in an Aave lending market through Nimiq Pay. The wallet integration is central to reviewing and authorizing the real on-chain actions.

## Verification status

The interface and transaction safeguards are implemented. Hosted browser testing and live verification of the Aave API, Nimiq Pay wallet, and real Polygon supply/withdrawal must be completed before claiming the product is fully verified. See the app’s live status and errors; unavailable services are not replaced with sample data.

Run the local logic tests with:

```sh
npm test
```

The Playwright suite is run with `npm run e2e` after installing the pinned development dependency and browser. It must be run against the actual deployed application to establish hosted browser coverage.

## Source

MIT licensed. See [LICENSE](LICENSE). Contributions and issue reports are welcome.
