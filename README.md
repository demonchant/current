# Current

**Move from a Polygon stablecoin balance to a verified Aave position, inside Nimiq Pay.** Current brings Aave V3 market information, wallet balances, transaction review, supply and withdrawal, and post-transaction verification into one mobile-friendly experience. It supports native Polygon USDC and the Polygon USDT reserve surfaced as USDT0 in Aave.

[Open Current on the web](https://current.oladapodamiey.workers.dev/) · [Open in Nimiq Pay](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev) · [Source code](https://github.com/demonchant/current)

> Current sends real transactions to Polygon and Aave V3. Supply rates vary and are not promised. Stablecoins can lose their peg, withdrawals depend on market liquidity, and smart-contract, token, wallet, RPC, relayer, and network risks apply. Review every wallet prompt.

## The problem: stablecoins are in the wallet, but the next step is hard

Imagine Amara, a young designer in Lagos who has just been paid for a freelance project. She keeps part of her balance in USDC because she wants to use it for a laptop upgrade in a few months. The funds are already in her Polygon wallet. She is not looking for another token, a complicated trading strategy, or a promise that her money will grow. She wants to understand whether she can supply the stablecoins to a lending market, what the current rate means, what she must approve, what network fee she will pay, and how to tell that the deposit actually arrived.

Today, getting those answers can mean moving between a wallet, a protocol interface, token documentation, a gas guide, and a block explorer. Each screen assumes the user already knows which network and token they are using. An approval prompt can look like a second deposit. A wallet saying “confirmed” does not explain whether the Aave position changed. On a phone, switching between apps and trying to retain all that context makes a straightforward action feel risky. If Amara gives up, the stablecoins remain idle—not because she chose that outcome after comparing options, but because the path to make an informed choice was too fragmented.

That is the specific problem Current addresses: **the usability and confidence gap between holding a supported Polygon stablecoin and managing that asset in Aave V3.** This is an illustrative user story, not a claim that every person has the same finances or experience.

## The solution: one continuous Aave journey

Current keeps the decision and the action together. From Nimiq Pay, a user can see the selected asset's Aave supply rate and reserve status, inspect the wallet balance and existing Aave position, choose an amount, understand the authorization and gas path, review the transaction, and then check the Polygon receipt and updated position. Supply and withdrawal both happen through Aave V3; Current does not create a separate yield product or custody user funds.

The result is not a claim that Aave is risk-free or that supplying is right for everyone. It is a clearer route for someone who has already decided to explore Aave: fewer context switches, a more legible transaction, and evidence of what happened afterward. Users keep control of the wallet and decide whether to proceed.

### How the flow works

1. **Understand the market.** Current reads Aave V3 reserve data for Polygon and displays the selected asset's variable supply APY and availability. If required market data is unavailable or does not match the configured market, the app surfaces that state and blocks dependent actions.
2. **Understand the position.** With a connected Polygon wallet, Current reads the selected token balance, aToken balance, allowance, and POL balance directly from Polygon. This shows what can be supplied, what is already supplied, and whether the standard transaction path has gas.
3. **Review the exact action.** The user selects USDT0 or native USDC, enters an amount, and reviews the asset, amount, Aave destination, approval, and gas or relay fee before opening the wallet.
4. **Authorize with bounded scope.** Where supported, supply uses a short-lived EIP-2612 permit for the exact amount and Aave Pool spender, followed by one supply transaction. If typed-data signing is unavailable, Current offers an exact-amount approval and then asks for a separate supply confirmation.
5. **Verify the outcome.** Current waits for the Polygon transaction receipt, refreshes the wallet data, and checks the position change before presenting success. A wallet prompt alone is never treated as proof that the position changed.
6. **Manage the position.** The user can return to inspect the live position and withdraw through Aave. Withdrawal is a direct Polygon transaction and requires POL for gas; it does not use the NIM relay.

### One focused product, supporting features

The product is the Aave journey above. The additional features support that same job:

- **NIM-paid supply gas:** for compatible Nimiq Pay sessions, the user can pay a disclosed NIM fee while the configured relayer submits the Polygon supply. This helps users who hold NIM but do not have POL available for that supply. The relay is optional, guarded by live Worker status, and supply-only. It does not remove Aave, stablecoin, or relayer risk; withdrawal still needs POL.
- **Position goal:** a per-wallet, per-asset target and date let users track an Aave position over time. Progress is based on the on-chain aToken balance. It is a follow-through aid for the Aave position, not a separate savings or financial product.
- **Naira context:** an indicative USD/NGN equivalent gives local context for a USD-denominated position. It is not an exchange, naira on-ramp, executable quote, or promise of protection from inflation or currency movement.

## Why this fits the Aave track

Current is built around using Aave V3 on Polygon, not merely displaying a token balance or adding an unrelated dashboard. Aave is the actual lending protocol in the core user journey:

- The market view reads Aave's Polygon market and selected reserve data, including variable supply APY and reserve availability.
- The wallet view identifies the selected underlying asset and its corresponding Aave aToken position.
- Supply calls Aave's Pool for the exact selected asset and amount. The permit path uses `supplyWithPermit`; the fallback is a bounded token approval followed by supply.
- Withdrawal calls Aave's Pool directly for the selected asset.
- The app verifies the Aave position against Polygon state after transaction confirmation.

This makes the protocol useful to a Nimiq Pay user at the point where the decision becomes an action: understand the current Aave option, move into a position with clear authorization, and check the result without losing the wallet context. Current's contribution to the track is the complete, mobile-ready interaction around Aave—not a claim that it improves Aave's rate, changes the protocol, or guarantees adoption or earnings.

## Assets, market data, and transaction design

Current targets **Polygon PoS mainnet (chain ID 137)** and two Aave reserves:

| Asset shown in Current | Polygon underlying | Aave position token |
| --- | --- | --- |
| USDT0 | Polygon USDT at [`0xc2132D05D31c914a87C6611C10748AEb04B58e8F`](https://polygonscan.com/address/0xc2132D05D31c914a87C6611C10748AEb04B58e8F) | aUSDT: [`0x6ab707Aca953eDAeFBc4fD23bA73294241490620`](https://polygonscan.com/address/0x6ab707Aca953eDAeFBc4fD23bA73294241490620) |
| Native USDC | Circle native Polygon USDC at [`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`](https://polygonscan.com/address/0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359) | aUSDC: [`0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD`](https://polygonscan.com/address/0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD) |

Both assets use six decimals. Current validates the Aave market, chain, underlying token, decimals, and matching aToken before enabling dependent actions. USDC refers to the native Polygon token, not USDC.e. The Aave Pool is [`0x794a61358D6845594F94dc1DB02A252b5b4814aD`](https://polygonscan.com/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD). Market data comes from the [Aave V3 GraphQL API](https://api.v3.aave.com/graphql); wallet balances and transaction results are read through the connected Polygon provider.

### Supply authorization

For supported wallets, Current builds a typed EIP-2612 permit for the selected token, wallet, exact amount, Aave Pool spender, nonce, and short expiry. Polygon USDT0's permit domain uses version 1 and a `salt`-encoded chain ID; native Polygon USDC uses version 2 and an explicit chain ID. The app validates the signature and transaction fields before requesting wallet submission. The permit authorizes the selected spend; the subsequent Aave supply is a separate on-chain action. If the wallet cannot sign typed data, the app falls back to an exact-amount approval and a separate supply transaction. Standard supply and all withdrawals require POL for Polygon gas.

### Every transaction and signature

| User action | What is signed or sent | Network and fee | What Current verifies |
| --- | --- | --- | --- |
| Standard supply with permit | The wallet signs a short-lived, exact-amount EIP-2612 permit (off-chain), then sends `supplyWithPermit` to the Aave V3 Pool. | Polygon; the supply transaction uses the user's POL. | The permit and transaction target, receipt, and resulting aToken position. |
| Standard supply fallback | The wallet sends an exact-amount token approval, then separately sends the Aave supply transaction. | Two Polygon transactions; user pays POL for each. | Approval calldata and spender/amount, followed by supply receipt and position change. |
| Withdrawal | The wallet sends a direct Aave Pool withdrawal for the selected asset and amount. | Polygon; user pays POL. | Transaction receipt and resulting position change. The NIM relay is not used. |
| NIM-paid supply | The wallet signs the supply permit, then sends a NIM payment containing the quoted recipient and memo. After server-side payment verification, the relayer sends the Aave `supplyWithPermit` transaction. | Nimiq payment plus Polygon supply. The user pays the disclosed NIM fee; the relayer pays Polygon POL. | Worker validates quote, owner, token, amount, balance, permit, and payment; tracks the job and prevents payment-hash reuse. Current reports the Polygon result after receipt and position verification. |
| Savings-goal access | The wallet signs a fresh `personal_sign` message for a goal read, save, or delete. | Wallet signature only; no blockchain transaction, gas, token approval, or asset transfer. | Worker verifies the wallet signature, action, and one-time nonce before accessing that wallet's goal. |

Approvals and signatures are not the same as supplying: an approval or permit authorizes a defined spend, while the Aave supply is the transaction that moves the selected asset into the protocol. Always inspect the wallet's own prompt. Transaction fees and status can differ by network conditions.

### NIM-paid supply and backend safeguards

The NIM route is an optional way to pay the operational gas cost for a supply. The button appears only on Supply and remains disabled with a specific explanation if relay configuration/status, wallet/network, Nimiq Pay payment access, live market data, entered amount, or operation state is not ready. The client never overrides a missing Worker configuration.

The Cloudflare Worker validates a short-lived quote against the wallet, token, amount, balance, and permit; simulates the intended Aave call; verifies the NIM payment details; and uses Durable Objects to track relay jobs and guard against reuse of a payment hash. Only then does the dedicated relayer submit the Polygon `supplyWithPermit` call. The NIM fee is operator-set, not a live Polygon gas quote. If payment is verified but the Aave supply fails, the job may require manual support review; the app does not promise an automatic refund. Users should not repeat a payment while its job is pending.

## Demo

The two videos show the same Aave-focused product in its two supported contexts. The **Nimiq Pay recording** demonstrates Current inside the mobile wallet host; the **web demo** is the version submitted for judging.

- [Current inside Nimiq Pay (mobile)](https://youtu.be/0zSfe1G3I2w) — wallet connection, Aave market and position, supply, withdrawal, and goal flow.
- [Current web demo (submitted)](https://youtu.be/EDPMHaYVrj0) — browser experience submitted for the project review.

Each recording documents a particular session; neither promises future service availability, market liquidity, or rates.

### Four wallet-position snapshots

These four screenshots were supplied as evidence of Current being used with Polygon USDT positions. Each separates the **scaled principal basis** shown by Aave from Current's **estimated accrued interest**; neither figure is a statement of realized profit or a promise of future yield. The screenshots do not display wallet addresses, so they show four position views but do not independently prove four unique on-chain identities.

| Snapshot | Supplied position | Scaled principal basis | Accrued interest estimate | POL shown for gas |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1.700329 USDT | 1.378298 USDT | 0.322031 USDT | 2.24217 POL |
| 2 | 1.300318 USDT | 1.054047 USDT | 0.246271 USDT | 7.32106 POL |
| 3 | 10.542777 USDT | 8.546045 USDT | 1.996732 USDT | 6.49733 POL |
| 4 | 1.700003 USDT | 1.378034 USDT | 0.321969 USDT | 2.60992 POL |

These are captured values from the screenshots, not live balances. Current derives the interest estimate by comparing the aToken balance with its scaled balance; aToken transfers can affect that principal basis.

| Position view 1 | Position view 2 |
| --- | --- |
| ![Current Polygon position snapshot 1 showing supplied USDT, principal basis, estimated accrued interest, and POL balance](<Screenshot 2026-11-10 111647.png>) | ![Current Polygon position snapshot 2 showing supplied USDT, principal basis, estimated accrued interest, and POL balance](<Screenshot 2026-11-10 111710.png>) |

| Position view 3 | Position view 4 |
| --- | --- |
| ![Current Polygon position snapshot 3 showing supplied USDT, principal basis, estimated accrued interest, and POL balance](<Screenshot 2026-11-10 111723.png>) | ![Current Polygon position snapshot 4 showing supplied USDT, principal basis, estimated accrued interest, and POL balance](<Screenshot 2026-11-10 111741.png>) |

## Run locally

Requirements: Node.js 24 or later and npm.

```sh
npm ci
npm run dev
```

Open `http://localhost:4173` for the landing page and `http://localhost:4173/app` for the app. No `.env` file is required for the local frontend. The deployed Cloudflare Worker is needed for cross-device goals and NIM relay APIs. Live wallet actions require a compatible injected EVM provider connected to Polygon, supported token balance, and POL for standard transaction gas.

## Verify

```sh
npm test
npx playwright install chromium
npm run dev
```

In a second terminal, run `npm run e2e`. These checks exercise code and browser behavior; they do not sign live transactions or guarantee that a real wallet, RPC, market, or transaction will be available.

To check the Worker bundle without publishing it:

```sh
npx wrangler deploy --dry-run
```

## Deploy and configure

The Cloudflare Worker serves the static app plus `/api/relay/*` and `/api/goals/*` endpoints. Deploy from an authenticated environment with:

```sh
npx wrangler deploy
```

NIM relay status is available at `GET /api/relay/status`. The endpoint returns enabled state and missing/invalid setting names without returning configured values. Keep the relay disabled until the status is enabled and the complete flow has been checked inside Nimiq Pay.

Configure these non-secret Worker variables:

| Variable | Purpose |
| --- | --- |
| `NIM_FEE_ADDRESS` | Nimiq mainnet recipient for the displayed fee. |
| `NIM_RELAY_FEE_LUNA` | Positive fee amount in Luna (100,000 Luna = 1 NIM). |
| `RELAY_SUPPORT_URL` | HTTPS support destination for manual review. |

Configure these as Worker secrets through the Cloudflare dashboard or Wrangler's interactive prompt. Never put secret values in source files or command arguments.

| Secret name | Purpose |
| --- | --- |
| `POLYGON_RPC_URL` | HTTPS Polygon RPC endpoint; may contain provider credentials. |
| `NIMIQ_RPC_URL` | HTTPS Nimiq RPC endpoint. |
| `RELAYER_PRIVATE_KEY` | Dedicated Polygon relayer key. |

```sh
npx wrangler secret put POLYGON_RPC_URL
npx wrangler secret put NIMIQ_RPC_URL
npx wrangler secret put RELAYER_PRIVATE_KEY
```

The Worker also requires the `RELAY_JOBS` and `PAYMENT_CLAIMS` Durable Object bindings and migrations in `wrangler.jsonc`. Fund and monitor the relayer's POL balance. A dry run verifies bundling/configuration shape only; it does not validate secrets, RPC access, Nimiq payment verification, or on-chain behavior.

## Supporting position tools

Savings goals are stored by the Worker by wallet and asset so the same wallet can retrieve them on another device. Every read or change requires a fresh, one-time `personal_sign` authorization with an action and nonce. This signature is not a transaction and grants no token allowance. Goal records contain a wallet address, asset, target, and date; they are not encrypted from the service operator. Progress uses the live on-chain aToken balance. Any projection uses the current variable Aave rate and is illustrative only.

Indicative NGN values use a USD/NGN exchange-rate feed. The browser caches the rate and checks for a refresh when the app opens if the cached rate is at least 24 hours old. It is not a live quote and does not refresh continuously during an open session. Stablecoins may deviate from their peg; the conversion is contextual information, not a promise of naira value.

## Security and risk

- Current is non-custodial software. It does not request users' seed phrases or private keys.
- Verify the network, asset, amount, destination, approval scope, and fee in each wallet prompt.
- Public wallet addresses and transactions are visible on-chain. Do not add sensitive notes to a goal.
- Keep RPC credentials and the relayer key in Worker secrets, never in frontend code, commits, screenshots, or chat. Use a dedicated relayer account and monitor it.
- Aave rates change with market conditions; withdrawal timing depends on available liquidity. No yield, peg, liquidity, or transaction outcome is guaranteed.
- A NIM payment that is verified before a failed relay may need manual support review; no automatic refund is promised.

Current is software for interacting with Aave and Polygon, not a bank, custodian, broker, naira on-ramp, or guarantee against inflation or currency depreciation. Use only funds you can afford to expose to these risks.

## Repository map

```text
public/          Landing page, app, styles, wallet flow, and domain validation
worker/index.js  Cloudflare Worker APIs, relay, goals, and payment verification
server.mjs       Local development server
wrangler.jsonc   Worker, asset, and Durable Object configuration
tests/           Domain and transaction validation tests
e2e/             Browser behavior and responsive-interface checks
```

## License

Current is released under the [MIT License](LICENSE).
