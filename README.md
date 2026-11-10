# Current

**Current is a wallet-first savings experience for supplying native Polygon USDC or USDT0 to Aave V3 through Nimiq Pay.** It brings the selected asset's live market rate, the user's on-chain position, a cross-device savings goal, and clear transaction status into one focused interface.

[Open Current](https://current.oladapodamiey.workers.dev/) · [Launch through Nimiq Pay](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev) · [Watch the walkthrough](https://youtu.be/EDPMHaYVrj0) · [Source code](https://github.com/demonchant/current)

> Current interacts with real Polygon contracts. Aave rates vary and returns are not guaranteed. Users remain responsible for checking the asset, network, wallet prompt, and network fee. Smart contract, market, stablecoin, liquidity, and network risks apply.

## The problem Current addresses

Someone holding USDC or USDT who wants to earn on it has to answer several questions before acting: which lending market is available, what rate it currently offers, how much of their wallet balance is free, what position they already have, what each wallet prompt will do, and whether the transaction actually completed. The information is often split between a protocol dashboard, a wallet, and a block explorer. After supplying funds, a rate snapshot alone also gives little reason to check back or track a longer-term target across devices.

That friction is especially visible inside a wallet mini-app. The experience should explain the live opportunity and the user's own position in the same place, keep each authorization understandable, and give the user a useful reason to return without suggesting that variable yield is guaranteed.

In short, the problem is not simply finding an APY. It is making a real on-chain savings action understandable from discovery through confirmation: show what the market currently offers, what the wallet actually owns, exactly what a signature or transaction authorizes, and whether the chain completed the action. Current is designed to reduce that context switching while leaving custody and final transaction approval with the user's wallet.

## How Current responds

Current lets the user select native USDC or USDT0 on Polygon and reads that asset's Aave V3 reserve, supply APY, wallet balance, POL gas balance, and aToken position. It checks the selected token and aToken against fixed contract addresses, then presents an explicit review before a wallet action. After submission it waits for the chain receipt and checks the matching position before showing completion.

The **Savings Goal** adds a lightweight follow-up loop. A user sets a target and date for the selected stablecoin; Current shows progress against the matching on-chain aToken balance and offers an illustrative projection using that reserve's current Aave rate. Goals are stored by the Current Worker and wallet address, separately for USDC and USDT0. Reading or changing a goal requires a fresh, one-time wallet signature over a clear action and nonce; no transaction or token approval is involved. The goal is not encrypted from the service operator, so it contains no information beyond the target and date. The progress bar follows the on-chain position; projected yield is only an estimate and is never guaranteed.

Together, the market view answers “what is available now?”, the position answers “where am I today?”, and the goal answers “what am I working toward?”. Users can return to refresh the market and wallet data as rates and balances change.

## What the app does

- Reads native Polygon USDC and USDT0 Aave V3 reserves, live supply APY, and reserve status from Aave's market API.
- Connects through the EVM provider exposed by the Nimiq Pay host and reads balances directly from Polygon.
- Shows the selected stablecoin available to supply, its matching aToken position, and POL available for network fees.
- Provides an “If today held” estimate and locally observed rate history to help put a variable APY in context.
- Lets each wallet save separate USDC and USDT0 targets on the Current backend and see progress from the corresponding live aToken balance on any device after wallet authorization.
- Prepares supply and withdrawal transactions for the exact amount entered and shows a review before wallet authorization.
- Uses each selected Polygon token's EIP-2612 permit with Aave's `supplyWithPermit` when approval is needed: one short-lived exact-amount signature, then one on-chain supply transaction. Native USDC uses its version 2, chain-ID EIP-712 domain; USDT0 uses its version 1, salt-based domain. Users can choose exact-amount approval if typed-data signing is unavailable.
- Offers optional NIM-paid Polygon gas inside Nimiq Pay for either selected asset. The app displays the operator-set NIM fee, recipient, and unique memo; the Worker binds the quote to the wallet, selected token, exact amount, and permit before its funded Polygon relayer submits `supplyWithPermit`.
- Checks the Polygon transaction receipt and updated position before reporting a completed action; links to PolygonScan for independent inspection.

Current is non-custodial software. It does not collect seed phrases or private keys. Wallet permissions and transaction confirmations are handled by the wallet host. Review every prompt; no app or wallet can guarantee a protocol outcome or investment return.

## User journeys and transaction behavior

### Standard supply

1. Connect a Polygon wallet and wait for the live wallet and Aave market data.
2. Select USDT0 or native USDC, then enter an amount. Current checks the amount against that token balance and the selected Aave reserve.
3. Review the exact amount and authorization. If the wallet supports typed-data signing, the normal route requests a short-lived permit for that exact amount and the Aave Pool spender, then submits one supply transaction. If it cannot sign typed data, the user can choose exact-amount approval followed by supply.
4. Confirm the transaction in the wallet. Current waits for its receipt and refreshes the position before reporting success.

### Withdrawal

Withdrawal is a direct Aave withdrawal. It does not use the NIM relay and does not change the relay's supply-only behavior. The wallet confirms the Polygon transaction and Current checks the result and updated position.

### Optional NIM-paid gas supply

The relay is an optional supply path for compatible Nimiq Pay sessions. Its button is shown only while Supply is selected. It remains disabled with a specific explanation if the relay Worker is not configured, the wallet/network is unavailable, the host cannot send a NIM payment with data, the amount or live market is unavailable, or another operation is in progress. The Worker must be configured; the browser must never assume relay availability.

When available, the flow requests a quote, prepares and simulates the exact supply, obtains the user's permit, then shows a review containing the NIM fee, recipient, and unique memo before the user confirms a NIM payment. The Worker verifies the payment and permit before its relayer submits the Polygon supply. The fee is operator-set and is not a live Polygon gas quote. A verified NIM payment followed by a failed supply may require manual support review; no automatic refund is promised. If status is pending, check the existing quote/status before considering another payment.

## Data, privacy, and security

- Wallet balances, positions, and submitted transactions are associated with the connected public address and Polygon. Never share a seed phrase or private key with Current.
- Rate history remains in browser storage. Savings goals are stored in the wallet's per-address Durable Object on Cloudflare and synchronized across devices when the same wallet connects. A fresh one-time `personal_sign` message authorizes each read, save, or delete; the message is not a transaction and grants no token allowance. The backend can see the wallet address, selected asset, target amount, and date, so users should not put sensitive notes in a goal.
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

Current's live transaction path targets **Polygon PoS mainnet (chain ID 137)**. The USDC option is Circle's native Polygon USDC contract, not the bridged USDC.e asset; the market and displayed position are selected independently for each token.

| Contract | Polygon address |
| --- | --- |
| USDT0 | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Native Polygon USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Aave USDT reserve token (aUSDT) | `0x6ab707Aca953eDAeFBc4fD23bA73294241490620` |
| Aave native USDC reserve token (aUSDC) | `0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD` |
| Aave market API | `https://api.v3.aave.com/graphql` |

The standard supply path requires the selected token and POL for Polygon gas. When an allowance is needed, it requests a short-lived typed signature for the exact amount and Aave Pool spender, then asks the wallet to confirm one `supplyWithPermit` Polygon transaction. Native USDC uses EIP-2612 domain version 2 with Polygon chain ID 137; USDT0 uses its version 1 domain with the chain ID encoded as `salt`. If typed-data signing is unavailable, the user can choose exact-amount approval followed by a separate supply transaction. Withdrawal remains a direct Aave withdrawal action for the selected asset.

Inside Nimiq Pay, users can alternatively choose **Supply with NIM-paid gas** when the relay is configured. The wallet signs an exact, short-lived permit for the selected token and a separate NIM payment with the displayed recipient and unique quote memo. The Cloudflare Worker binds the quote to the selected asset and simulates the exact Aave call before showing the payment prompt, then verifies the NIM transaction before relaying the supply. The NIM fee is fixed by the operator, not a live estimate of Polygon gas. If supply fails after NIM is received, the app reports **manual fee review**; it does not promise an automatic refund. Check every wallet prompt and never repeat a payment while relay status is pending. See the [Aave V3 Pool reference](https://www.aave.com/docs/aave-v3/smart-contracts/pool), [Polygon USDT0 EIP-2612 guidance](https://docs.usdt0.to/technical-documentation/token-features/eip-2612), [Circle USDC contract](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/FiatTokenV2_2.sol), and [Nimiq payment API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider).

## Run locally

Requirements: Node.js 24 or later and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:4173` for the landing page or `http://localhost:4173/app` for the app. No `.env` file is needed. Market data comes from Aave's public GraphQL API. Live wallet actions require a compatible injected wallet on Polygon with the required token and POL balance.

The local server serves the frontend and static assets; it does not automatically provide the Cloudflare Worker Durable Objects, cross-device savings-goal API, or a configured NIM relay. Backend goal synchronization and relay actions therefore require the deployed Worker and its `RELAY_JOBS` binding. Do not add secrets to a local file that could be committed.

## Verification

```sh
npm test
npx playwright install chromium
npm run dev
```

In a second terminal, run `npm run e2e`. Browser automation covers interface behavior and wallet-provider states; it does not sign or submit live financial transactions. The recorded walkthrough documents the live Polygon demonstration.

For a local Worker bundle check without publishing it, run `npx wrangler deploy --dry-run`. This validates bundling and bindings but does not verify deployed secrets, live RPC access, wallet prompts, or on-chain transactions.

## Deploy

The app, `/api/relay/*`, and wallet-authenticated `/api/goals/*` endpoints run in one Cloudflare Worker. Deploy with Wrangler authenticated to the account that owns the Worker:

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

The Worker also needs the existing `RELAY_JOBS` and `PAYMENT_CLAIMS` Durable Object bindings and migrations defined in `wrangler.jsonc`. `RELAY_JOBS` stores short-lived relay quotes and per-wallet savings goals; goal records are separated by wallet address and asset. The relayer account must have enough POL to submit Polygon transactions. Before enabling the relay for users, confirm the support process and fee/refund policy, test in a controlled environment, verify that `/api/relay/status` reports enabled, and validate the full flow inside Nimiq Pay. A Wrangler dry run does not validate runtime secrets or live wallet or goal-signature behavior.

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
| Savings goal does not sync to another device | Connect the same wallet address, use Polygon, approve the read-only `personal_sign` message, and ensure the deployed Worker has the `RELAY_JOBS` Durable Object binding. Goal signatures are one-use and must be renewed for each read or change. |
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
