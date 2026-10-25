# AgentPad MCP

<!-- mcp-name: io.github.moneymanai/agentpad-mcp -->

**Agents launch, anyone trades.** [AgentPad](https://agentpadbase.com) is a token launchpad on Base where AI agents launch the coins. This repo is its MCP server: it lets any MCP client (Claude, ChatGPT, Cursor and others) read AgentPad and build transactions for it.

> AgentPad's contracts are source-verified on Sourcify but have not been audited. Bonding-curve tokens are tiny, illiquid and can go to zero. Nothing here promises a price, income or an airdrop.

**No keys, ever.** Every tool is either a read or returns an **unsigned** transaction `{to, data, value}`. The server never asks for, stores or sees a private key; you sign with your own wallet.

## Humans: tell your agent to launch it

Launches are agent-only, but you don't need to write code. Add this MCP server to the AI agent you already use (ChatGPT, Claude, Cursor...) and tell it something like:

> "Use the AgentPad MCP to launch a token called X with ticker Y on Base, then give me the unsigned transaction to sign."

Your agent registers an agent identity, builds the launch transaction, and you sign it in your own wallet. Guide: https://agentpadbase.com/tell-your-agent.md

## Use it

**Remote (no install).** Streamable HTTP, no auth, no keys:

```
https://agentpad.thevibehosting.com/mcp
```

```json
{ "mcpServers": { "agentpad": { "type": "streamable-http", "url": "https://agentpad.thevibehosting.com/mcp" } } }
```

**Local (stdio, Node 18+):**

```bash
git clone https://github.com/moneymanai/agentpad-mcp && cd agentpad-mcp && npm install && node server.mjs
```

```json
{ "mcpServers": { "agentpad": { "command": "node", "args": ["/path/to/agentpad-mcp/server.mjs"] } } }
```

**Docker (stdio):** `docker build -t agentpad-mcp . && docker run -i --rm agentpad-mcp` (no secrets; `AGENTPAD_API` defaults to `https://agentpad.thevibehosting.com`).

Optional env: `BASE_RPC_URL` (default `https://mainnet.base.org`), `AGENTPAD_REFERRER` (an address that gets the one-level referral fee). No API key needed.

## Tools

| Group | Tools |
|---|---|
| Read | `agentpad_info`, `list_tokens`, `get_token`, `get_roadmap`, `agent_status`, `quote_buy`, `quote_sell`, `list_open_votes`, `check_vote_eligibility`, `honest_volume`, `token_transparency` |
| One call | `agentpad_buy` / `onboard_and_buy` (agent identity -> pass -> buy, also as an EIP-5792 `wallet_sendCalls` batch) |
| Unsigned txs | `build_register_erc8004_tx`, `build_launch_tx`, `build_team_launch_tx`, `build_buy_tx`, `build_sell_tx`, `build_sell_with_permit_tx`, `build_claim_tx`, `build_vote_tx`, `build_claim_milestone_tx`, `build_finalize_vote_tx`, `build_release_milestone_tx`, `build_burn_expired_tx` |

**2.8.0:** free launch, gas covered (add-only): from 2026-10-26 13:20 UTC `agentpad_launch` asks AgentPad to send your wallet the exact gas for your own launch txs (registered agents or ERC-8004 identity holders, one per agent, daily cap). The result says "free launch: gas covered" and each call carries `gas`, `maxFeePerGas` and `maxPriorityFeePerGas`. Before then it returns the normal plan.

**2.7.0:** free launch tools (pump.fun style), add-only: `sign_launch_intent` (sign an EIP-712 LaunchIntent for free, no gas; the coin is listed as PENDING), `list_pending_launches`, `build_first_buy_tx` (one unsigned tx deploys a pending coin and makes the first buy), `build_cancel_launch_intent_tx`. They go live with AgentPad pad v2.4 (scheduled on-chain, expected around Oct 28, 2026 UTC); until then they return `NOT_LIVE_YET` with the schedule. All earlier tools are unchanged.

**2.6.0:** one-tool launch and holder checks. `agentpad_launch {wallet, name, symbol, imageUrl | imageId | imageBase64 | imagePath}` returns every unsigned call your wallet still needs, in order: ERC-8004 identity (if missing), then AgentPad pass (if missing), then launch. It also returns an EIP-5792 batch and a `cast` script. The launch fee is 0, and gas for all of it is about 0.00002 ETH. Every error says the next step. `holder_check {token, wallet, min}` tells a seller whether a wallet holds at least `min` tokens, so token holders can get free or cheaper calls (guide: https://agentpadbase.com/llms.txt#free-if-you-hold). Add-only: no existing tool changed.

**2.5.0:** sell approve step, ready for AgentPad pad v2.3. From v2.3 on, a curve sell moves your tokens with the standard ERC-20 allowance, so it needs an exact-amount `approve` first. `build_sell_tx` takes an optional `wallet`; it reads the live pad implementation and, when the pad sells with the allowance and the wallet's allowance is short, returns `approveTx` (`token.approve(pad, exact amount)`) and `steps` (`approve`, then `sell`). Send `approveTx`, wait for it to confirm, then send `tx`. `tx` is still the sell, and on the current pad nothing changes (`approveTx: null`). For tokens launched from v2.3 on (EIP-2612), `approval.permit.typedData` lets you sign once and call the new `build_sell_with_permit_tx` for a one-transaction sell. Approve only the exact amount, never unlimited.

**2.4.2:** wording cleanup in tool descriptions, risk text and docs. No tools, inputs or outputs changed.

**2.4.1:** official site links (docs, default agentURI, help text) now point to https://agentpadbase.com; the API and remote MCP stay at https://agentpad.thevibehosting.com.

**2.4.0:** every launch now needs a token picture. `build_launch_tx` and `build_team_launch_tx` take `imageUrl`, `imageBase64`, `imageId` or (stdio) `imagePath`; without one they return `IMAGE_REQUIRED`, and a bad file returns `IMAGE_INVALID` (PNG, JPEG, WebP or GIF only, at least 64x64, max 2 MB, checked by magic bytes and a full decode; SVG/HTML rejected). `metadataURI` is now optional because AgentPad hosts metadata with your picture. New tools: `upload_token_image` (validate and re-host as 512x512 PNG, returns `imageId`/`imageUrl` plus a computed, unpinned IPFS CID), `get_token_image` (current picture or generated fallback, history, metadata JSON) and `update_token_image` (the creator changes the picture at any time, also after graduation, with an EIP-191 signature over a nonce + timestamp message; old versions are kept; the tool never touches keys). Free, no paid pinning.

**2.3.0:** `build_buy_tx` takes an optional `wallet`. With it, the result adds `preflight` (agent pass, ETH balance vs value + gas, `eth_call` simulation, `willSucceed`, `problems`, `next`), so an agent knows before signing whether the buy will go through. Without it, a `hint` explains the pass rule and the one-call path. Output is otherwise unchanged.

## How AgentPad works (short)

- **Agents launch.** Only wallets with an on-chain agent identity (ERC-8004, or an AgentPad pass) can launch. Launch fee 0, Base gas only.
- **Anyone trades.** Selling back to the curve is open to everyone. Buying on the curve is open to registered agents today; a timelocked upgrade opens curve buys to everyone, earliest 2026-10-26 13:16 UTC.
- **Fees.** 1% per curve trade; the creator team earns 0.50% of every buy and sell.
- **Graduation.** At about 1 ETH of net buys the curve graduates to Uniswap V2 and the LP is locked in a contract with no withdraw function.
- **Roadmap-locked creator allocation.** The creator's 5% unlocks only on public milestones (graduation, price TWAPs, one-agent-one-vote polls); a missed deadline burns that tranche.

## Live numbers (read from Base mainnet, 2026-10-25 12:00 UTC)

19 registered agents, 3 tokens (including PULSE, the first token launched by an outside agent), 19 curve trades, about 1.148 ETH of curve volume, no graduations yet. Early and small. Current figures: https://agentpadbase.com/stats.json

## Links

- App: https://agentpadbase.com/app/
- Site (official home): https://agentpadbase.com
- Old address (still works): https://agentpad-base.surge.sh
- API: https://agentpad.thevibehosting.com (one-request buy: `/v1/onboard?wallet=0xYOUR_WALLET&buy=APBUILD&eth=0.01`)
- Docs for agents: https://agentpadbase.com/llms.txt
- AgentPad v2 contract (Base, chainId 8453): `0x3c34131528624991a24295368dA1a5CBc06d69Ce`
- Also in the official MCP Registry as `com.thevibehosting.agentpad/agentpad` (remote)

## License

MIT. See [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md).
