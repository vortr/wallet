> **📦 Read-only mirror** of [`vortr/sdk`](https://github.com/vortr/sdk) → `packages/wallet`.
> Install: `npm i @vortr/wallet` · issues & PRs: **[vortr/sdk](https://github.com/vortr/sdk)** · auto-synced on release.

---

# @vortr/wallet

Local non-custodial **signer** MCP for [Vortr](https://vortragents.com). It auto-fills
your wallet address, fetches keyless calldata from the public Vortr connector,
and signs + broadcasts Base swaps after a per-swap confirmation. **The hosted
Vortr never holds your key** — it lives only in this local process.

## Why

The remote connector (`https://www.vortragents.com/mcp`) is keyless: `build_swap`
returns calldata you sign yourself. `@vortr/wallet` is the local piece that does
that signing for an agent — no pasting an address, no opening a browser.

## Tools

| Tool | What it does |
|------|--------------|
| `search_tokens` | Search the Base token registry — symbol, name, or address. |
| `get_quote` | Live 0x quote for this wallet (taker auto-filled). Read-only preview. |
| `wallet_address` | This signer's Base address (use as the taker). |
| `prepare_swap` | `{ sellToken, buyToken, amount? \| usd?, slippageBps? }` → `{ confirm_token, summary, expiresAt }`. Does **not** broadcast. |
| `execute_swap` | `{ confirm_token }` → signs + broadcasts; returns `{ hash }`. |
| `swap_status` | `{ hash }` → `pending \| confirmed \| failed`. |

## Setup (Hermes Agent)

### Single MCP (simplest)

`@vortr/wallet` is now self-contained — it proxies search/quote/build from the
keyless connector and signs locally. An agent needs only this one entry:

```yaml
mcp_servers:
  vortr:                       # LOCAL signer — search/quote/build/sign all-in-one
    command: "npx"
    args: ["-y", "@vortr/wallet"]
    env:
      VORTR_SIGNER_KEY: "0x…"  # a HOT wallet with a measured balance
```

### Two servers (advanced)

Run a separate remote connector alongside the local signer if you want to give
an agent read-only access without a key, or use a different connector endpoint.
Put the key in `env`, **never** in chat.

```yaml
mcp_servers:
  vortr:                       # remote, keyless: search/quote/build (Hermes speaks HTTP MCP — add by URL)
    url: "https://www.vortragents.com/mcp"
  vortr-wallet:                # LOCAL, holds your key
    command: "npx"
    args: ["-y", "@vortr/wallet"]
    env:
      VORTR_SIGNER_KEY: "0x…"  # a HOT wallet with a measured balance
```

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `VORTR_SIGNER_KEY` | — (required) | EOA private key. Local only. |
| `VORTR_API_BASE` | `https://www.vortragents.com/mcp` | Keyless connector to fetch calldata from. |
| `VORTR_BASE_RPC_URL` | `https://mainnet.base.org` | Base RPC for broadcast + receipts. |

## Flow

```
you:   swap $5 usdc to eth
agent: prepare_swap → "sell 5 USDC · receive ≈ 0.00190 ETH (min 0.00189) · approve?"
you:   yes
agent: execute_swap(confirm_token) → sent 0x… (confirmed)
```

The quote is live 0x pricing. The summary shows the **expected** receive
(`summary.buy`) alongside the guaranteed **minimum** (`summary.buyMin`, the
post-slippage floor) — default slippage is 0.25%, so the two sit close together;
the floor is worst-case, not the likely fill. `confirm_token` binds your approval
to the exact calldata and expires with the build (~30s) — if it lapses, prepare again. The
token is persisted to a temp file (single-use, expiry-checked), so `execute_swap`
finds it even if it runs in a different process than `prepare_swap`.

`prepare_swap` preflights your on-chain balance: if the wallet can't cover the sell
amount it returns `insufficient <TOKEN> …` instead of building an unfillable swap.
Token approval (when needed) is part of the calldata `execute_swap` replays — there
is no separate approve step.

## Security

- Fund a **hot wallet** you can afford to lose. Confirmation bounds intent, not
  blast radius.
- The key is never logged, never returned by a tool, never sent to Vortr.
- Base-only (chain 8453).
