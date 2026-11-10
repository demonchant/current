# Current

**Current is a wallet-first savings experience for supplying Polygon USDT to Aave V3 through Nimiq Pay.** It brings the live market rate, a user's own on-chain position, a simple savings target, and clear transaction status into one focused interface.

[Open Current](https://current.oladapodamiey.workers.dev/) · [Launch through Nimiq Pay](https://nimpay.app/miniapps/open/current.oladapodamiey.workers.dev) · [Watch the walkthrough](https://youtu.be/EDPMHaYVrj0) · [Source code](https://github.com/demonchant/current)

> Current interacts with real Polygon contracts. Aave rates vary and returns are not guaranteed. Users remain responsible for checking the asset, network, wallet prompt, and network fee. Smart contract, market, stablecoin, liquidity, and network risks apply.

## The problem Current addresses

Someone holding USDT who wants to earn on it has to answer several questions before acting: which lending market is available, what rate it currently offers, how much of their wallet balance is free, what position they already have, what each wallet prompt will do, and whether the transaction actually completed. The information is often split between a protocol dashboard, a wallet, and a block explorer. After supplying funds, a rate snapshot alone also gives little reason to check back or track a longer-term target.

That friction is especially visible inside a wallet mini-app. The experience should explain the live opportunity and the user's own position in the same place, keep each authorization understandable, and give the user a useful reason to return without suggesting that variable yield is guaranteed.

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
- Checks the Polygon transaction receipt and updated position before reporting a completed action; links to PolygonScan for independent inspection.

Current is non-custodial software. It does not collect seed phrases or private keys. Wallet permissions and transaction confirmations are handled by the wallet host. Review every prompt; no app or wallet can guarantee a protocol outcome or investment return.

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

Supply requires USDT and POL for Polygon gas. When an allowance is needed, the default flow requests a short-lived typed signature for the exact amount and Aave Pool spender, then asks the wallet to confirm a single `supplyWithPermit` Polygon transaction. The signature alone does not move funds, and the supply transaction still requires POL gas. If the wallet does not support typed-data signing, the user can explicitly switch to a conventional exact USDT approval followed by a separate supply transaction. Withdrawal remains a direct Aave withdrawal action. The wallet prompt is authoritative: verify the token, amount, network, contract, and fee before confirming. See the [Aave V3 Pool reference](https://www.aave.com/docs/aave-v3/smart-contracts/pool) and [Polygon USDT0 EIP-2612 guidance](https://docs.usdt0.to/technical-documentation/token-features/eip-2612) for the permit interface and Polygon-specific signing domain.

## Run locally

Requirements: Node.js 24 or later and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:4173` for the landing page or `http://localhost:4173/app` for the app. No `.env` file is needed. Market data comes from Aave's public GraphQL API. Live wallet actions require a compatible injected wallet on Polygon with the required token and POL balance.

## Verification

```sh
npm test
npx playwright install chromium
npm run dev
```

In a second terminal, run `npm run e2e`. Browser automation covers interface behavior and wallet-provider states; it does not sign or submit live financial transactions. The recorded walkthrough documents the live Polygon demonstration.

## Deploy

The repository serves static assets through a Cloudflare Worker. Deploy with Wrangler authenticated to the account that owns the Worker:

```sh
npx wrangler deploy
```

## Repository map

```text
public/                 Landing page, app, styles, wallet flow, and domain validation
server.mjs              Local development server
wrangler.jsonc          Cloudflare Worker static-asset configuration
tests/                  Domain and transaction validation tests
e2e/                    Browser behavior and responsive-interface checks
```

## License

Current is released under the [MIT License](LICENSE).
