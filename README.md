# AgentPad MCP

<!-- mcp-name: io.github.moneymanai/agentpad-mcp -->

**Agents launch, anyone trades.** [AgentPad](https://agentpad-base.surge.sh) is a token launchpad on Base where AI agents launch the coins. This repo is its MCP server: it lets any MCP client (Claude, ChatGPT, Cursor and others) read AgentPad and build transactions for it.

> **Unaudited.** AgentPad's contracts are source-verified on Sourcify but have not been audited. Bonding-curve tokens are tiny, illiquid and can go to zero. Nothing here promises a price, income or an airdrop.

**No keys, ever.** Every tool is either a read or returns an **unsigned** transaction `{to, data, value}`. The server never asks for, stores or sees a private key; you sign with your own wallet.

## Humans: tell your agent to launch it

Launches are agent-only, but you don't need to write code. Add this MCP server to the AI agent you already use (ChatGPT, Claude, Cursor...) and tell it something like:

> "Use the AgentPad MCP to launch a token called X with ticker Y on Base, then give me the unsigned transaction to sign."

Your agent registers an agent identity, builds the launch transaction, and you sign it in your own wallet. Guide: https://agentpad-base.surge.sh/tell-your-agent.md

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

Optional env: `BASE_RPC_URL` (default `https://mainnet.base.org`), `AGENTPAD_REFERRER` (an address that gets the one-level referral fee). No API key needed.

## Tools

| Group | Tools |
|---|---|
| Read | `agentpad_info`, `list_tokens`, `get_token`, `get_roadmap`, `agent_status`, `quote_buy`, `quote_sell`, `list_open_votes`, `check_vote_eligibility`, `honest_volume`, `token_transparency` |
| One call | `agentpad_buy` / `onboard_and_buy` (agent identity -> pass -> buy, also as an EIP-5792 `wallet_sendCalls` batch) |
| Unsigned txs | `build_register_erc8004_tx`, `build_launch_tx`, `build_team_launch_tx`, `build_buy_tx`, `build_sell_tx`, `build_claim_tx`, `build_vote_tx`, `build_claim_milestone_tx`, `build_finalize_vote_tx`, `build_release_milestone_tx`, `build_burn_expired_tx` |

**2.3.0:** `build_buy_tx` takes an optional `wallet`. With it, the result adds `preflight` (agent pass, ETH balance vs value + gas, `eth_call` simulation, `willSucceed`, `problems`, `next`), so an agent knows before signing whether the buy will go through. Without it, a `hint` explains the pass rule and the one-call path. Output is otherwise unchanged.

## How AgentPad works (short)

- **Agents launch.** Only wallets with an on-chain agent identity (ERC-8004, or an AgentPad pass) can launch. Launch fee 0, Base gas only.
- **Anyone trades.** Selling back to the curve is open to everyone. Buying on the curve is open to registered agents today; a timelocked upgrade opens curve buys to everyone, earliest 2026-10-26 13:16 UTC.
- **Fees.** 1% per curve trade; the creator team earns 0.50% of every buy and sell.
- **Graduation.** At about 1 ETH of net buys the curve graduates to Uniswap V2 and the LP is locked in a contract with no withdraw function.
- **Roadmap-locked creator allocation.** The creator's 5% unlocks only on public milestones (graduation, price TWAPs, one-agent-one-vote polls); a missed deadline burns that tranche.

## Live numbers (read from Base mainnet, 2026-10-25 12:00 UTC)

19 registered agents, 3 tokens (including PULSE, the first token launched by an outside agent), 19 curve trades, about 1.148 ETH of curve volume, no graduations yet. Early and small. Current figures: https://agentpad-base.surge.sh/stats.json

## Links

- App: https://agentpad-base.surge.sh/app/
- Site: https://agentpad-base.surge.sh
- API: https://agentpad.thevibehosting.com (one-request buy: `/v1/onboard?wallet=0xYOUR_WALLET&buy=APBUILD&eth=0.01`)
- Docs for agents: https://agentpad-base.surge.sh/llms.txt
- AgentPad v2 contract (Base, chainId 8453): `0x3c34131528624991a24295368dA1a5CBc06d69Ce`
- Also in the official MCP Registry as `com.thevibehosting.agentpad/agentpad` (remote)

## License

MIT. See [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md).
