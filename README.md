# Current

**Current is a Nimiq Pay Mini App for supplying and withdrawing Polygon USDT through Aave V3.** It brings the live lending market, a wallet’s available balance, the user’s Aave position, and an explicit transaction review into one focused Earn experience.

[Open Current](https://current.oladapodamiey.workers.dev/) · [Watch the live walkthrough](https://youtu.be/EDPMHaYVrj0) · [Source code](https://github.com/demonchant/current)

> Current submits real Polygon mainnet transactions through the connected wallet. Aave rates vary, returns are not guaranteed, and protocol, smart contract, token, and network risks apply. Review every wallet prompt and network fee before signing.

## Demo note: Current opens inside Nimiq Pay. During recording, Nimiq Pay displayed a notice that USDT payments were temporarily unavailable, so the video uses MetaMask to demonstrate the Polygon/Aave flow.

## The problem

Using a lending market can involve switching between a market page, a wallet, token approval prompts, a protocol transaction, and a block explorer. That makes it harder to understand what is being authorized and whether a transaction actually completed.

Current brings those steps together for a focused USDT Earn flow in Nimiq Pay. It shows market context and the connected wallet position, explains each transaction before the wallet opens, and reports completion only after checking the Polygon receipt and reading the resulting position.

## What Current does

- Reads the Aave V3 Polygon USDT reserve and current supply APY from Aave’s market API.
- Connects to the EVM wallet provided by Nimiq Pay and reads the wallet’s Polygon balances and Aave position.
- Shows the user’s USDT available to supply, aUSDT position, and POL available for gas.
- Prepares supply and withdrawal actions for the exact amount entered by the user.
- Shows a transaction review with the asset, amount, protocol target, allowance, and network fee context before wallet authorization.
- Requests an exact USDT allowance for supply where required; approval and supply are separate wallet actions.
- Waits for the Polygon receipt and reads the wallet’s updated Aave position before displaying the completed state.
- Links transaction records to PolygonScan so users can inspect the public on-chain result.
- Calculates an illustrative estimate from the currently read supply rate. The estimate is not a promised or fixed return.

Current is non-custodial. It does not receive private keys or move funds without the user authorizing the wallet transaction.

## Live product and walkthrough

- **Open in Nimiq Pay:** [Launch Current](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev)
- **Live web app:** [current.oladapodamiey.workers.dev](https://current.oladapodamiey.workers.dev/)
- **Video walkthrough:** [Current supply, withdrawal, and PolygonScan confirmations](https://youtu.be/EDPMHaYVrj0)
- **X post:** [Current update](https://x.com/thoyourbaby/status/2119029326611919338)
- **GitHub:** [demonchant/current](https://github.com/demonchant/current)

For the intended wallet experience, use **Launch Current** to open the Mini App through Nimiq Pay. The live web app is also available directly for inspection, but transaction actions require the compatible EVM wallet provider supplied by the Nimiq Pay host. Current's transaction path is configured for Polygon mainnet; switching Nimiq Pay’s Nimiq network does not change the EVM transaction network.

## Recorded live verification

The owner’s recorded walkthrough shows the real product used with a connected wallet on Polygon, including both transaction directions:

1. **Supply:** review the 1.3 USDT amount and exact one-time allowance, authorize the wallet transactions, and see Current confirm the Polygon receipt and updated aUSDT position.
2. **Withdrawal:** begin with 1.300011 USDT supplied, review the withdrawal details and Aave pool, authorize the wallet transaction, and wait for its Polygon result.
3. **Independent explorer check:** PolygonScan displays the withdrawal as successful, including the transaction hash, block, and confirmations.

The withdrawal result visible in the walkthrough is:

| Field | Recorded result |
| --- | --- |
| Action | Withdraw 1.300011 USDT0 from Aave |
| Network | Polygon PoS |
| PolygonScan status | Success |
| Transaction hash | `0x2c541c296b4d29f677ca248f95baaffbc34a24bf81cddbee06a0a27d51f67b6a` |
| Block | `96758664` |
| Confirmations visible in recording | `79` |

The live run and transaction results are shown in the [video walkthrough](https://youtu.be/EDPMHaYVrj0). Additional screenshots and supporting evidence were supplied separately with the hackathon submission and are intentionally not included in this source repository. The confirmation details above describe the recorded run; they are not a claim about the wallet’s current balance or the market’s current rate.

## Network and assets

Current’s transaction path targets **Polygon PoS mainnet, chain ID 137**.

| Item | Polygon address |
| --- | --- |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Aave USDT reserve token (aUSDT) | `0x6ab707Aca953eDAeFBc4fD23bA73294241490620` |
| Aave market data API | `https://api.v3.aave.com/graphql` |

To perform a live transaction, the connected Polygon wallet needs the relevant USDT or Aave position and POL for network fees. Supply can require two confirmations: an exact token approval followed by the supply transaction. Withdrawal uses the supplied Aave position and requires a separate wallet signature. Wallet prompts are authoritative; inspect the destination, amount, chain, and fee before approving.

## Open Current in Nimiq Pay

The direct Mini App entry point is:

**[Launch Current in Nimiq Pay](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev)**

This is the preferred route for judges and users testing wallet functionality. If the Mini App does not open from the link, open Nimiq Pay and launch Current from its Mini Apps directory.

## Built for the Nimiq Earn track

Current is designed for the **Earn** category of the Nimiq Mini Apps Competition. It makes an existing lending-market workflow accessible from Nimiq Pay: users can inspect the current Aave USDT supply rate, see the position held by their wallet, and manage supply or withdrawal while retaining control of every authorization.

The Earn mechanism is the Aave V3 lending market itself. APY is variable and depends on market conditions. The projection in the interface is an estimate based on a rate snapshot, not a guarantee, financial recommendation, or promise of profit.

## Interface and transaction safety

The interface distinguishes live market data, wallet state, transaction review, pending transactions, and completed outcomes. It does not treat a wallet prompt or transaction submission as proof of completion. Completion follows a Polygon receipt check and a fresh position read.

Before opening the wallet, Current validates the requested transaction against the connected wallet, Polygon chain, expected USDT contract, Aave pool, operation, and exact amount. Supply approval is scoped to the entered amount. If the market response or wallet state does not match the expected Polygon reserve, the action is stopped and the interface explains the issue.

## Run locally

Requirements: Node.js 24 or later and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:4173` for the project landing page or `http://localhost:4173/app` for the app. The project does not require an `.env` file. Live market data uses Aave’s public GraphQL endpoint. Wallet actions require Nimiq Pay’s injected EVM wallet and a Polygon wallet with the necessary asset and gas balance.

## Tests

Run the domain and transaction validation tests:

```sh
npm test
```

Run the Playwright browser suite:

```sh
npx playwright install chromium
npm run dev
```

In a second terminal:

```sh
npm run e2e
```

The browser suite checks the landing and app view, live market data or honest unavailable behavior, wallet-provider behavior outside Nimiq Pay, disabled actions without the host wallet, key links, keyboard focus, mobile layout, and reduced-motion preference. The live Polygon supply and withdrawal results are demonstrated separately in the recorded walkthrough because browser automation does not sign or submit consequential wallet transactions.

## Deploy

The app is served as static assets by Cloudflare Workers. The repository includes `wrangler.jsonc` and the public assets configuration.

```sh
npx wrangler deploy
```

Deployment requires Wrangler authentication to the Cloudflare account that owns the Worker. The deployed URL is [current.oladapodamiey.workers.dev](https://current.oladapodamiey.workers.dev/).

## Repository map

```text
public/                 Landing page, app, styles, wallet flow, and domain validation
server.mjs              Local development server
wrangler.jsonc           Cloudflare Worker static asset configuration
tests/domain.test.mjs    Amount, contract, and transaction validation tests
e2e/current.spec.mjs    Browser behavior and responsive interface checks
 ```

## License

Current is released under the [MIT License](LICENSE).
