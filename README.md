# Current

**Current is a wallet-first savings experience for supplying Polygon USDT to Aave V3 through Nimiq Pay.** It brings the live market rate, a user's own on-chain position, a simple savings target, and clear transaction status into one focused interface.

[Open Current](https://current.oladapodamiey.workers.dev/) · [Launch through Nimiq Pay](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev) · [Watch the walkthrough](https://youtu.be/EDPMHaYVrj0) · [Source code](https://github.com/demonchant/current)

> Current interacts with real Polygon contracts. Aave rates vary and returns are not guaranteed. Users remain responsible for checking the asset, network, wallet prompt, and network fee. Smart contract, market, stablecoin, liquidity, and network risks apply.

## The problem Current addresses

Someone holding USDT who wants to earn on it has to answer several questions before acting: which lending market is available, what rate it currently offers, how much of their wallet balance is free, what position they already have, what each wallet prompt will do, and whether the transaction actually completed. The information is often split between a protocol dashboard, a wallet, and a block explorer. After supplying funds, a rate snapshot alone also gives little reason to check back or track a longer-term target.

That friction is especially visible inside a wallet mini-app. The experience should explain the live opportunity and the user's own position in the same place, keep each authorization understandable, and give the user a useful reason to return without suggesting that variable yield is guaranteed.

In short, the problem is not simply finding an APY. It is making a real on-chain savings action understandable from discovery through confirmation: show what the market currently offers, what the wallet actually owns, exactly what a signature or transaction authorizes, and whether the chain completed the action. Current is designed to reduce that context switching while leaving custody and final transaction approval with the user's wallet.

## How Current responds

Current makes Aave V3's Polygon USDT market easier to inspect and use from Nimiq Pay. It reads the market's current supply APY and reserve status, reads the connected wallet's USDT, POL gas balance, and aUSDT position from Polygon, and presents an explicit review before a wallet action. After submission it waits for the chain receipt and checks the resulting wallet position before showing completion.

The **Savings Goal** adds a lightweight follow-up loop. A user sets a USDT target and date; Current shows progress against the wallet's actual aUSDT balance and offers an illustrative projection using the current Aave rate. The goal is saved locally in that browser, separately for each wallet address. It is not sent to a Current backend. The progress bar follows the on-chain position; projected yield is only an estimate that assumes today's rate holds and is never counted as guaranteed progress.

Together, the market view answers “what is available now?”, the position answers “where am I today?”, and the goal answers “what am I working toward?”. Users can return to refresh the market and wallet data as rates and balances change.

## What the app does

- Reads the Aave V3 Polygon USDT reserve, live supply APY, and reserve status from Aave's market API.
- Connects through the EVM provider exposed by the Nimiq Pay host and reads balances directly from Polygon.
- Shows USDT available to supply, the wallet's aUSDT position, and POL available for network fees.
- Provides an “If today held” estimate and locally observed rate history to help put a variable APY in context.
- Lets each connected wallet save a private, browser-local target amount and date and see progress from its live aUSDT balance.
- Prepares supply and withdrawal transactions for the exact amount entered and shows a review before wallet authorization.
- Uses Polygon USDT's EIP-2612 permit with Aave's `supplyWithPermit` when approval is needed: one short-lived exact-amount signature, then one on-chain supply transaction. Users can choose the standard exact-approval route if their wallet cannot sign typed data.
- Offers optional NIM-paid Polygon gas inside Nimiq Pay. The app displays the operator-set NIM fee, recipient, and unique memo; the Worker verifies the NIM payment and exact USDT permit before its funded Polygon relayer submits `supplyWithPermit` on behalf of the user.
- Checks the Polygon transaction receipt and updated position before reporting a completed action; links to PolygonScan for independent inspection.

Current is non-custodial software. It does not collect seed phrases or private keys. Wallet permissions and transaction confirmations are handled by the wallet host. Review every prompt; no app or wallet can guarantee a protocol outcome or investment return.

## User journeys and transaction behavior

### Standard supply

1. Connect a Polygon wallet and wait for the live wallet and Aave market data.
2. Enter a USDT amount. Current checks the amount against the wallet balance and current Aave reserve availability.
3. Review the exact amount and authorization. If the wallet supports typed-data signing, the normal route requests a short-lived permit for that exact amount and the Aave Pool spender, then submits one supply transaction. If it cannot sign typed data, the user can choose exact-amount approval followed by supply.
4. Confirm the transaction in the wallet. Current waits for its receipt and refreshes the position before reporting success.

### Withdrawal

Withdrawal is a direct Aave withdrawal. It does not use the NIM relay and does not change the relay's supply-only behavior. The wallet confirms the Polygon transaction and Current checks the result and updated position.

### Optional NIM-paid gas supply

The relay is an optional supply path for compatible Nimiq Pay sessions. Its button is shown only while Supply is selected. It remains disabled with a specific explanation if the relay Worker is not configured, the wallet/network is unavailable, the host cannot send a NIM payment with data, the amount or live market is unavailable, or another operation is in progress. The Worker must be configured; the browser must never assume relay availability.

When available, the flow requests a quote, prepares and simulates the exact supply, obtains the user's permit, then shows a review containing the NIM fee, recipient, and unique memo before the user confirms a NIM payment. The Worker verifies the payment and permit before its relayer submits the Polygon supply. The fee is operator-set and is not a live Polygon gas quote. A verified NIM payment followed by a failed supply may require manual support review; no automatic refund is promised. If status is pending, check the existing quote/status before considering another payment.

## Data, privacy, and security

- Wallet balances, positions, and submitted transactions are associated with the connected public address and Polygon. Never share a seed phrase or private key with Current.
- Savings goals and locally observed rate history are stored in browser storage on the user's device. The goal is not sent to a Current backend. Clearing site data can remove this local information.
- Market data is requested from Aave's public GraphQL API. Polygon reads and writes use the connected wallet/provider and configured RPC infrastructure.
- The optional relay uses Cloudflare Worker runtime configuration and Durable Objects for quote/job state and payment-hash reuse protection. Do not put secrets in browser code, source control, screenshots, issue reports, or this README.
- Relay signing keys and any credential-bearing RPC URLs belong in Cloudflare Worker secrets. Keep the relayer wallet dedicated and funded only as operationally required; monitor its POL balance and relay status.
- Review the destination, network, amount, fee, and calldata details presented by the wallet. A completed wallet prompt is not proof of a successful protocol transaction; wait for Current's receipt and position checks.

Current is software for interacting with third-party smart contracts, not a bank, custodian, broker, or source of guaranteed yield. Aave rates can change, and protocol, token, liquidity, wallet, RPC, smart-contract, relayer, and network risks remain. Use only funds you can afford to expose to those risks.

## Fit for Nimiq Pay Earn

Current uses Nimiq Pay as the user's wallet-facing entry point and Aave V3 as the Polygon lending market. The app keeps the Earn journey together: discover the current rate, connect and inspect a real position, choose a target, review an exact supply authorization, and confirm the resulting on-chain position. The savings goal encourages users to revisit their progress while keeping the underlying balance and every transaction in the user's wallet control.

## Product access and demo notes

- **Nimiq Pay Mini App:** [Launch Current](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev)
- **Live web deployment:** [current.oladapodamiey.workers.dev](https://current.oladapodamiey.workers.dev/)
- **Walkthrough:** [Recorded Current demo](https://youtu.be/EDPMHaYVrj0)
- **Project update:** [X post](https://x.com/thoyourbaby/status/2119029326611919338)
- **GitHub:** [demonchant/current](https://github.com/demonchant/current)

Use the Nimiq Pay launch link for the intended in-app wallet experience. The transaction integration is configured for Polygon PoS, chain ID 137. The browser deployment is useful for inspecting the interface; wallet actions need a compatible injected EVM provider.

During the demo recording, Nimiq Pay showed USDT withdrawal/payment as temporarily unavailable. This is an upstream Nimiq Pay service limitation: the recording used a separate Polygon-compatible wallet to demonstrate the Current/Aave flow. Current does not control Nimiq Pay's USDT withdrawal service or represent that maintenance as a Current transaction failure. Wallet balances are per address and chain; funds held in a Nimiq Pay account will not appear in Current's Polygon balance unless they are available in the connected Polygon wallet.

Screenshots supplied by the builder show four different wallet addresses connected to Current, with funds still visible in those wallets.

## Recorded on-chain demonstration

The walkthrough shows the live app on Polygon, including a USDT supply, a separate withdrawal, and PolygonScan confirmation. The recorded withdrawal evidence is:

| Field | Recorded result |
| --- | --- |
| Action | Withdraw 1.300011 USDT0 from Aave |
| Network | Polygon PoS |
| PolygonScan status | Success |
| Transaction hash | `0x2c541c296b4d29f677ca248f95baaffbc34a24bf81cddbee06a0a27d51f67b6a` |
| Block | `96758664` |

These details describe the recorded transaction only. They do not describe a current wallet balance or guarantee future market conditions.

## Network and contracts

Current's live transaction path targets **Polygon PoS mainnet (chain ID 137)**.

| Contract | Polygon address |
| --- | --- |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Aave USDT reserve token (aUSDT) | `0x6ab707Aca953eDAeFBc4fD23bA73294241490620` |
| Aave market API | `https://api.v3.aave.com/graphql` |

The standard supply path requires USDT and POL for Polygon gas. When an allowance is needed, it requests a short-lived typed signature for the exact amount and Aave Pool spender, then asks the wallet to confirm one `supplyWithPermit` Polygon transaction. If typed-data signing is unavailable, the user can choose exact USDT approval followed by a separate supply transaction. Withdrawal remains a direct Aave withdrawal action.

Inside Nimiq Pay, users can alternatively choose **Supply with NIM-paid gas** when the relay is configured. The wallet signs two separate authorizations: an exact, short-lived USDT permit for Aave and a NIM payment with the displayed recipient and unique quote memo. The Cloudflare Worker simulates the exact Aave call before showing the payment prompt, then checks the NIM transaction before relaying the supply. The NIM fee is fixed by the operator, not a live estimate of Polygon gas. If supply fails after NIM is received, the app reports **manual fee review**; it does not promise an automatic refund. Check every wallet prompt and never repeat a payment while relay status is pending. See the [Aave V3 Pool reference](https://www.aave.com/docs/aave-v3/smart-contracts/pool), [Polygon USDT0 EIP-2612 guidance](https://docs.usdt0.to/technical-documentation/token-features/eip-2612), and [Nimiq payment API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider).

## Run locally

Requirements: Node.js 24 or later and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:4173` for the landing page or `http://localhost:4173/app` for the app. No `.env` file is needed. Market data comes from Aave's public GraphQL API. Live wallet actions require a compatible injected wallet on Polygon with the required token and POL balance.

The local server serves the frontend and static assets; it does not automatically provide the Cloudflare Worker Durable Objects or a configured NIM relay. Relay actions therefore require a Worker environment with the bindings and runtime configuration described below. Do not add secrets to a local file that could be committed.

## Verification

```sh
npm test
npx playwright install chromium
npm run dev
```

In a second terminal, run `npm run e2e`. Browser automation covers interface behavior and wallet-provider states; it does not sign or submit live financial transactions. The recorded walkthrough documents the live Polygon demonstration.

For a local Worker bundle check without publishing it, run `npx wrangler deploy --dry-run`. This validates bundling and bindings but does not verify deployed secrets, live RPC access, wallet prompts, or on-chain transactions.

## Deploy

The app and `/api/relay/*` endpoint run in one Cloudflare Worker. Deploy with Wrangler authenticated to the account that owns the Worker:

```sh
npx wrangler deploy
```

The NIM relay stays disabled until configured. The app requests `GET /api/relay/status`; the response exposes whether relay configuration is complete, the fee unit, and names of settings that are absent or fail format validation. It never returns configured values or secrets. If the Worker reports incomplete configuration, or the status endpoint cannot be reached, the app keeps the supply action safely disabled and explains the corresponding reason. The button is shown on the Supply tab so the user can see relay availability; it is hidden on Withdraw.

These non-secret Worker variables are defined in `wrangler.jsonc` and can be changed there:

| Variable | Purpose and expected format |
| --- | --- |
| `NIM_FEE_ADDRESS` | Nimiq mainnet address that receives the displayed fee. |
| `NIM_RELAY_FEE_LUNA` | Positive integer fee in Luna; 100,000 Luna equals 1 NIM. |
| `RELAY_SUPPORT_URL` | HTTPS support page for payments that need manual review. |

Configure these as **Worker secrets**, never as plaintext README values:

| Secret | Purpose |
| --- | --- |
| `POLYGON_RPC_URL` | HTTPS Polygon RPC endpoint. It may contain provider credentials. |
| `NIMIQ_RPC_URL` | HTTPS Nimiq RPC endpoint. |
| `RELAYER_PRIVATE_KEY` | Private key for the dedicated Polygon relayer account. |

The Worker also needs the `RELAY_JOBS` and `PAYMENT_CLAIMS` Durable Object bindings and migrations defined in `wrangler.jsonc`. The relayer account must have enough POL to submit Polygon transactions. Before enabling the relay for users, confirm the support process and fee/refund policy, test in a controlled environment, verify that `/api/relay/status` reports enabled, and validate the full flow inside Nimiq Pay. A Wrangler dry run does not validate runtime secrets or the live wallet flow.

`wrangler.jsonc` is the source of truth for these three public relay variables. It sets `keep_vars` to `true` so any additional non-secret variables configured in the Cloudflare dashboard are preserved during Wrangler deployments. `NIMIQ_RPC_URL` may be a secret if it contains provider credentials; otherwise it can be configured as a variable, but define it only once. Secrets are managed separately and are not removed by code deployments.

Add secrets through Cloudflare's dashboard or Wrangler's interactive secret command, substituting only the secret name when prompted:

```sh
npx wrangler secret put POLYGON_RPC_URL
npx wrangler secret put NIMIQ_RPC_URL
npx wrangler secret put RELAYER_PRIVATE_KEY
```

Set the three non-secret variables in the Cloudflare Worker settings. Then deploy intentionally with `npx wrangler deploy`. Confirm that the deployment serves the app, that `/api/relay/status` returns the expected enabled state, and that relay quotes and support links work before announcing relay availability. Do not paste secret values into terminal commands, CI logs, chat, or commits.

The relayer wallet pays Polygon gas and submits supply transactions for the permit owner. Monitor its POL balance. Durable Objects prevent reuse of the same NIM payment hash across quotes and track supply status. A failed or reverted supply after verified NIM payment enters manual review; no automatic NIM refund is provided. Publish a support contact and refund policy before enabling the relay for public use.

Set `RELAY_SUPPORT_URL` to an HTTPS support page before enabling the relay; it is shown when a payment needs manual review. Market data and wallet access are explicitly shown as unavailable when their providers cannot be reached. The live host wallet prompt and transaction behavior still require validation inside Nimiq Pay after deployment; a browser preview is not proof of an in-app wallet transaction.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Market or reserve data is unavailable | Check Aave GraphQL availability, the browser network connection, and the displayed market refresh time. Current disables actions when required market data is stale or unavailable. |
| Wallet is not available | Open the app through Nimiq Pay or another compatible injected EVM wallet, grant the requested wallet connection, and switch to Polygon PoS (chain ID 137). |
| Standard supply is disabled | Check the connection, Polygon network, live reserve availability, entered amount, USDT balance, and wallet POL balance. |
| NIM relay says it is not configured | Check the Worker runtime variables and secrets, Durable Object bindings/migrations, then inspect `GET /api/relay/status`. Do not bypass this gate in the browser. |
| NIM relay says payment access is unavailable | Use a Nimiq Pay host session that provides `window.nimiq.sendBasicTransactionWithData`; a normal browser preview may not expose it. |
| Relay payment is pending or needs review | Do not repeat the payment. Check the quote status and use the configured support URL for manual review. |
| A transaction prompt was accepted but the app has no success state | Wait for the chain receipt and position refresh, then inspect the transaction on PolygonScan. A wallet prompt alone does not establish on-chain completion. |

## Repository map

```text
public/                 Landing page, app, styles, wallet flow, and domain validation
worker/index.js         Cloudflare relay API and NIM payment verification
server.mjs              Local development server
wrangler.jsonc          Cloudflare Worker static-asset configuration
tests/                  Domain and transaction validation tests
e2e/                    Browser behavior and responsive-interface checks
```

## License

Current is released under the [MIT License](LICENSE).
