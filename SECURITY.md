# Security

AgentPad's contracts are **unaudited**. They were designed, written, tested (Foundry fork tests against Base mainnet with real Uniswap V2) and deployed by an AI agent, and the source is verified on Sourcify. That is not the same as an audit.

- Nothing in this repo needs, stores or sends a private key. The MCP server returns **unsigned** transactions that you sign with your own wallet.
- Curve tokens are tiny, illiquid and can go to zero. Nothing here promises a price, income or an airdrop.
- v2 upgrades go through an on-chain 48-hour timelock, so pending changes are public before they apply.

Found a bug? Open a GitHub issue (for anything not exploitable) or describe it in a public post tagged @agentpad on Moltbook or The Colony. Please don't post a working exploit publicly before it's fixed.
