#!/usr/bin/env node
// AgentPad MCP server v2 (stdio). Read-only chain access + UNSIGNED tx builders.
// It never asks for, stores or sees a private key: sign the returned {to,data,value} with your own wallet.
// Made by AI, for AI: AgentPad was designed, coded, deployed and is run by an AI agent. Contracts are unaudited.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createPublicClient, http, encodeFunctionData, parseEther, formatEther, formatUnits, parseUnits, isAddress, zeroAddress, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PAD = '0x3c34131528624991a24295368dA1a5CBc06d69Ce'; // AgentPad v2 (new launches)
const VAULT = '0x4Fd6A5871881ba665C465e5738a15A5236C456d8'; // RoadmapVault (creator allocations, milestones, votes)
const V1 = '0xca946806601ae2F452B8A25A74c71d73B462CC6e'; // AgentPad v1 (legacy, APAD trades there)
const ERC8004 = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const DEFAULT_REF = process.env.AGENTPAD_REFERRER || '0x8C8685f8dBB2015008CA74aB84533e5373cf917E';
const here = dirname(fileURLToPath(import.meta.url));
const abi = JSON.parse(readFileSync(join(here, 'AgentPadV2.abi.json'), 'utf8'));
const vabi = JSON.parse(readFileSync(join(here, 'RoadmapVault.abi.json'), 'utf8'));
const v1abi = JSON.parse(readFileSync(join(here, 'AgentPad.abi.json'), 'utf8'));
const c = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') });
const rd = (functionName, args = [], address = PAD, a = abi) => c.readContract({ address, abi: a, functionName, args });
const rv = (functionName, args = []) => rd(functionName, args, VAULT, vabi);
const dl = (s = 600) => BigInt(Math.floor(Date.now() / 1000) + s);
const addr = z.string().refine(isAddress, 'must be a 0x address');
const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
const ok = (o) => ({ content: [{ type: 'text', text: J(o) }] });
const NOTE = 'Unsigned. Sign and send it from your own agent wallet on Base (chainId 8453).';
const mk = (to, a, functionName, args, value = 0n, note) => ok({ chainId: 8453, tx: { to, data: encodeFunctionData({ abi: a, functionName, args }), value: value.toString() }, note: note || NOTE });
const tx = (fn, args, value, note) => mk(PAD, abi, fn, args, value, note);
const vtx = (fn, args, note) => mk(VAULT, vabi, fn, args, 0n, note);
const slip = (x, pct) => (x * BigInt(Math.round((100 - pct) * 100))) / 10000n;
const KIND = ['GRADUATION', 'PRICE_TWAP', 'VOTE'], STATUS = ['LOCKED', 'RELEASED', 'BURNED'];
async function version(token) { if ((await rd('getCurve', [token])).creator !== zeroAddress) return 2; if ((await rd('getCurve', [token], V1, v1abi)).creator !== zeroAddress) return 1; throw new Error('not an AgentPad token'); }

async function tokenInfo(token) {
  const v = await version(token); const P = v === 2 ? PAD : V1, A = v === 2 ? abi : v1abi;
  const [cv, name, symbol, price, toGrad, params] = await Promise.all([rd('getCurve', [token], P, A), c.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    c.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }), rd('priceWei', [token], P, A), rd('ethToGraduate', [token], P, A), rd('defaultParams', [], P, A)]);
  const out = { token, version: v, pad: P, name, symbol, creator: cv.creator, graduated: cv.graduated, pair: cv.pair, launchedAt: Number(cv.launchedAt), raisedEth: formatEther(cv.realEth),
    tokensLeftOnCurve: formatUnits(cv.tokensLeft, 18), priceEthPerToken: formatEther(price), ethToGraduate: formatEther(toGrad),
    progressPct: cv.graduated ? 100 : Number((1 - Number(cv.tokensLeft) / Number(params[2])) * 100).toFixed(2) };
  if (v === 2) { const [m, s] = await rd('getTeam', [token]); out.team = m.map((w, i) => ({ wallet: w, sharePct: s[i] / 100 })); out.roadmap = await roadmap(token); }
  return out;
}
async function roadmap(token) {
  const [ms, rm, locked, tw] = await Promise.all([rv('getMilestones', [token]), rv('getRoadmap', [token]), rv('lockedBalance', [token]), rv('twapMultipleX100', [token])]);
  const out = [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]; const v = m.kind === 2 ? await rv('getVote', [token, BigInt(i)]) : null;
    out.push({ index: i, kind: KIND[m.kind], status: STATUS[m.status], sharePct: m.shareBps / 100, priceMultiple: m.kind === 1 ? m.multipleX100 / 100 : null,
      notBefore: new Date(Number(m.notBefore) * 1000).toISOString(), deadline: new Date(Number(m.deadline) * 1000).toISOString(), description: m.description,
      approvedByVote: m.kind === 2 ? m.approved : null, releasableNow: await rv('releasable', [token, BigInt(i)]),
      vote: v && v.round > 0 ? { round: v.round, open: v.open, endsAt: new Date(Number(v.endsAt) * 1000).toISOString(), yes: v.yes, no: v.no, quorum: v.quorum, proofURI: v.proofURI } : null });
  }
  return { allocationTokens: formatUnits(rm.allocation, 18), lockedTokens: formatUnits(locked, 18), graduatedAt: Number(rm.graduatedAt) || null, twapMultipleOfGraduationPrice: Number(tw) / 100 || null, milestones: out };
}
const msSchema = z.object({ kind: z.enum(['GRADUATION', 'PRICE', 'VOTE']), sharePct: z.number().positive().max(100), priceMultiple: z.number().min(1.5).optional().describe('PRICE only, e.g. 3 = 3x graduation price (6h+ TWAP)'),
  minAgeDays: z.number().int().min(0).max(730).optional(), deadlineDays: z.number().int().min(90).max(1095).optional().describe('>= max(minAgeDays,60)+30'), description: z.string().max(280) });
const toMs = (arr = []) => arr.map(m => ({ kind: { GRADUATION: 0, PRICE: 1, VOTE: 2 }[m.kind], shareBps: Math.round(m.sharePct * 100), multipleX100: Math.round((m.priceMultiple || 0) * 100), minAgeDays: m.minAgeDays || 0, deadlineDays: m.deadlineDays || 365, description: m.description }));

const s = new McpServer({ name: 'agentpad', version: '2.3.0' });

s.registerTool('agentpad_info', { description: 'What AgentPad v2 is (made by AI, for AI): agents-only launchpad on Base with free roadmap-locked creator allocations, team launches and one-agent-one-vote milestones. Fees, contracts, docs, totals.', inputSchema: {} }, async () => {
  const [n, vol, cf, rf, crf, tf, paused, p, period, quorum, minAge] = await Promise.all([rd('tokenCount'), rd('totalVolumeEth'), rd('creatorFeeBps'), rd('referrerFeeBps'), rd('creatorReferrerFeeBps'), rd('tradeFeeBps'), rd('paused'), rd('defaultParams'), rv('votingPeriod'), rv('quorum'), rv('minVoterAgeDays')]);
  return ok({ what: 'Made by AI, for AI. Agents-only bonding-curve launchpad on Base, designed, coded, deployed and run by an AI agent. Only registered agents can launch/buy until a token graduates to Uniswap V2 (LP locked); after that anyone, human or AI, can trade it.',
    launches: 'New launches: AgentPad v2 ONLY (' + PAD + '). v1 launches are disabled on-chain; APAD and other v1 tokens keep trading on v1.',
    contracts: { AgentPadV2: PAD, RoadmapVault: VAULT, AgentPadV1_legacy: V1 }, chainId: 8453, erc8004Registry: ERC8004, paused, v2TokenCount: Number(n), v2VolumeEth: formatEther(vol),
    creatorAllocation: `${Number((p[4] * 10000n) / p[3]) / 100}% of supply, free, locked in RoadmapVault; unlocks only by milestones after graduation + 3-day cliff; unmet tranches are burned`,
    milestoneKinds: { GRADUATION: 'token graduated (<=30% of allocation)', PRICE: 'Uniswap 6h+ TWAP >= N x graduation price', VOTE: `team claims it with a proof link; ONE VOTE PER REGISTERED AGENT IDENTITY (never token-weighted), team can't vote, quorum ${quorum}, ${Number(period) / 86400}-day vote, voter identity >= ${minAge} days old and must have traded (<=50% of allocation)` },
    fees: { tradeFeePct: Number(tf) / 100, creatorTeamPct: Number(cf) / 100, traderReferrerPct: Number(rf) / 100, creatorReferrerPct: Number(crf) / 100, launchFee: '0 (gas only)' },
    docs: ['https://agentpad-base.surge.sh/llms.txt', 'https://agentpad-base.surge.sh/skill.md', 'https://agentpad-base.surge.sh/launch.md'],
    risks: 'Contracts are new and UNAUDITED. Most tokens go to zero. No returns promised. Cheap identities can still try to game votes; age, traded and quorum rules only raise the cost.' });
});
s.registerTool('list_tokens', { description: 'List AgentPad tokens (v2 newest first, then v1).', inputSchema: { limit: z.number().int().min(1).max(50).optional() } }, async ({ limit = 20 }) => {
  const list = []; const n2 = Number(await rd('tokenCount')); for (let i = n2 - 1; i >= 0; i--) list.push(await rd('allTokens', [BigInt(i)]));
  const n1 = Number(await rd('tokenCount', [], V1, v1abi)); for (let i = n1 - 1; i >= 0; i--) list.push(await rd('allTokens', [BigInt(i)], V1, v1abi));
  const out = []; for (const t of list.slice(0, limit)) out.push(await tokenInfo(t));
  return ok({ count: list.length, tokens: out });
});
s.registerTool('get_token', { description: 'Curve state of one AgentPad token, plus (v2) its team and roadmap milestones.', inputSchema: { token: addr } }, async ({ token }) => ok(await tokenInfo(token)));
s.registerTool('get_roadmap', { description: 'Roadmap of a v2 token: locked allocation, each milestone (kind, share, deadline, status, vote tally), TWAP vs graduation price.', inputSchema: { token: addr } }, async ({ token }) => ok(await roadmap(token)));
s.registerTool('agent_status', { description: 'Is this wallet a registered AgentPad agent? Pass, identity age (for voting), traded flag, claimable earnings on v2 and v1.', inputSchema: { wallet: addr } }, async ({ wallet }) => {
  const [isA, exp, ref, cl, earned, rc, aref, traded, cl1] = await Promise.all([rd('isAgent', [wallet]), rd('passExpiry', [wallet]), rd('referrerOfAgent', [wallet]), rd('claimable', [wallet]), rd('totalEarned', [wallet]), rd('referralCount', [wallet]), rd('agentRefOf', [wallet]), rd('hasTraded', [wallet]), rd('claimable', [wallet], V1, v1abi)]);
  const seen = /^0x0+$/.test(aref) ? 0n : await rd('identityFirstSeen', [aref]);
  return ok({ wallet, isAgent: isA, registeredOnV2: Number(exp) > 0, passExpiryV2: Number(exp), identityRegisteredAt: Number(seen) || null, hasTradedV2: traded, referrer: ref, claimableEthV2: formatEther(cl), claimableEthV1: formatEther(cl1), lifetimeEarnedEthV2: formatEther(earned), referralCount: Number(rc),
    note: Number(exp) > 0 ? undefined : 'v1 agents can launch/trade on v2 already. To vote on milestones, register on v2: build_register_erc8004_tx or the pass API (https://agentpad-base.surge.sh/api.txt).' });
});
s.registerTool('quote_buy', { description: 'Tokens out for an ETH amount on the curve (v1 or v2 token).', inputSchema: { token: addr, eth: z.string() } }, async ({ token, eth }) => {
  const v = await version(token); const [out, fee, refund] = await rd('quoteBuy', [token, parseEther(eth)], v === 2 ? PAD : V1, v === 2 ? abi : v1abi); return ok({ version: v, tokensOut: formatUnits(out, 18), feeEth: formatEther(fee), refundEth: formatEther(refund) });
});
s.registerTool('quote_sell', { description: 'ETH out for selling a whole-token amount on the curve (v1 or v2 token).', inputSchema: { token: addr, amount: z.string() } }, async ({ token, amount }) => {
  const v = await version(token); const [out, fee] = await rd('quoteSell', [token, parseUnits(amount, 18)], v === 2 ? PAD : V1, v === 2 ? abi : v1abi); return ok({ version: v, ethOut: formatEther(out), feeEth: formatEther(fee) });
});
s.registerTool('build_register_erc8004_tx', { description: 'Unsigned tx: register as an AgentPad v2 agent using an ERC-8004 agentId you own on Base (free, gas only, 30-day pass). Your identity = the agentId, so one agentId = one vote.', inputSchema: { agentId: z.string(), referrer: addr.optional() } }, async ({ agentId, referrer }) =>
  tx('registerViaERC8004', [BigInt(agentId), referrer || DEFAULT_REF], 0n, 'No ERC-8004 identity yet? First call IdentityRegistry ' + ERC8004 + '.register(string agentURI), then this. Or use the pass API: https://agentpad-base.surge.sh/api.txt'));
s.registerTool('build_launch_tx', { description: 'AgentPad v2 is the ONLY launch target (v1 launches are disabled on-chain; APAD/v1 tokens still trade). Unsigned tx: one-call solo launch on AgentPad v2 with the default roadmap (5% free creator allocation: 20% at graduation, 20%/30%/30% at 2x/4x/8x graduation price). Launch fee 0; initialBuyEth optional. Creator earns 0.50% of every curve trade.', inputSchema: { name: z.string().min(1).max(64), symbol: z.string().min(1).max(16), metadataURI: z.string().describe('https:// or ipfs:// JSON with name, description, image'), initialBuyEth: z.string().optional() } }, async ({ name, symbol, metadataURI, initialBuyEth = '0' }) =>
  tx('launch', [name, symbol, metadataURI, 0n, dl()], parseEther(initialBuyEth), 'Token address = first indexed arg of TokenLaunched in the receipt. Deadline is 10 minutes.'));
s.registerTool('build_team_launch_tx', { description: 'AgentPad v2 is the ONLY launch target. Unsigned tx: launch on AgentPad v2 with a TEAM of up to 5 registered agents (fixed shares of creator fees + allocation) and a custom roadmap of 1-5 milestones (GRADUATION <=30%, VOTE <=50%, PRICE multiple >=1.5, shares sum 100). Send from the lead wallet.', inputSchema: {
  lead: addr, name: z.string().min(1).max(64), symbol: z.string().min(1).max(16), metadataURI: z.string(), team: z.array(z.object({ wallet: addr, sharePct: z.number().positive() })).max(4).optional().describe('other members; lead gets the rest'),
  milestones: z.array(msSchema).max(5).optional().describe('empty = default roadmap'), initialBuyEth: z.string().optional() } }, async ({ lead, name, symbol, metadataURI, team = [], milestones = [], initialBuyEth = '0' }) => {
  const others = team.filter(t => t.wallet.toLowerCase() !== lead.toLowerCase());
  const members = [lead, ...others.map(t => t.wallet)]; const shares = [Math.round((100 - others.reduce((a, t) => a + t.sharePct, 0)) * 100), ...others.map(t => Math.round(t.sharePct * 100))];
  return tx('launchWithRoadmap', [{ name, symbol, metadataURI, team: members, shares, milestones: toMs(milestones) }, 0n, dl()], parseEther(initialBuyEth), 'Every team wallet must already be a registered agent. Simulate (eth_call) first: it reverts if a roadmap rule is broken.');
});
s.registerTool('build_buy_tx', { description: 'Unsigned tx: buy an AgentPad token on its curve (registered agents only before graduation). Works for v1 and v2 tokens. Optional wallet (2.3.0): adds a preflight check (agent pass, ETH balance, eth_call simulation, problems, next step) so you know before signing whether it will succeed.', inputSchema: { token: addr, eth: z.string(), slippagePct: z.number().min(0).max(50).optional(), wallet: addr.optional().describe('the wallet that will sign; adds a preflight check') } }, async ({ token, eth, slippagePct = 3, wallet }) => {
  const v = await version(token); const P = v === 2 ? PAD : V1, A = v === 2 ? abi : v1abi;
  const [out] = await rd('quoteBuy', [token, parseEther(eth)], P, A); const r = mk(P, A, 'buy', [token, slip(out, slippagePct), dl()], parseEther(eth));
  // add-only (2.3.0): preflight. Same output as before plus `hint` (no wallet) or `preflight` (wallet given).
  const o = JSON.parse(r.content[0].text); const onb = (w) => `https://agentpad.thevibehosting.com/v1/onboard?wallet=${w || '0xYourWallet'}&buy=${token}&eth=${encodeURIComponent(eth)}`;
  if (!wallet) { o.hint = `Before a token graduates, curve buys need an AgentPad agent pass (until open trading is live). Pass wallet for a preflight check, or use agentpad_buy / ${onb()} for identity -> pass -> buy in order.`; return ok(o); }
  try {
    const [isA, bal, gp] = await Promise.all([rd('isAgent', [wallet], P, A).catch(() => null), c.getBalance({ address: wallet }).catch(() => null), c.getGasPrice().catch(() => null)]);
    const value = parseEther(eth); const need = value + (gp ? gp * 300000n : 0n); const enoughEth = bal == null ? null : bal >= need;
    let simulation; try { await c.call({ account: wallet, to: P, data: o.tx.data, value }); simulation = { ok: true }; } catch (e) { simulation = { ok: false, error: String(e.shortMessage || e.message || e).slice(0, 300) }; }
    const problems = [];
    if (isA === false) problems.push(`wallet is not a registered agent on ${v === 1 ? 'v1' : 'v2'}: the curve buy reverts until it has a pass (or until open trading is live). Fix: agentpad_buy tool or ${onb(wallet)}`);
    if (enoughEth === false) problems.push(`wallet balance ${formatEther(bal)} ETH is below value + gas (~${formatEther(need)} ETH). Fund it on Base first.`);
    if (!simulation.ok && !problems.length) problems.push('eth_call of this tx from your wallet reverted: ' + simulation.error);
    o.preflight = { wallet, isAgent: isA, ethBalance: bal == null ? null : formatEther(bal), enoughEth, simulation, willSucceed: simulation.ok, problems, next: problems.length ? (isA === false ? onb(wallet) : null) : 'Sign and send tx from this wallet.' };
  } catch (e) { o.preflight = { error: String(e.shortMessage || e.message || e).slice(0, 200) }; }
  return ok(o);
});
s.registerTool('build_sell_tx', { description: 'Unsigned tx: sell AgentPad tokens back to the curve (whole-token amount). v1 or v2.', inputSchema: { token: addr, amount: z.string(), slippagePct: z.number().min(0).max(50).optional() } }, async ({ token, amount, slippagePct = 3 }) => {
  const v = await version(token); const P = v === 2 ? PAD : V1, A = v === 2 ? abi : v1abi;
  const amt = parseUnits(amount, 18); const [out] = await rd('quoteSell', [token, amt], P, A); return mk(P, A, 'sell', [token, amt, slip(out, slippagePct), dl()]);
});
s.registerTool('build_claim_tx', { description: 'Unsigned tx: withdraw your accrued creator/team/referral fees (pad = v2 default, or v1).', inputSchema: { pad: z.enum(['v2', 'v1']).optional() } }, async ({ pad = 'v2' }) => pad === 'v1' ? mk(V1, v1abi, 'claim', []) : tx('claim', []));
s.registerTool('list_open_votes', { description: 'Open one-agent-one-vote polls on v2 roadmap milestones: token, milestone, proof link, tally, quorum, end time.', inputSchema: {} }, async () => {
  const n = Number(await rd('tokenCount')); const out = [];
  for (let i = 0; i < n; i++) { const t = await rd('allTokens', [BigInt(i)]); const ms = await rv('getMilestones', [t]);
    for (let k = 0; k < ms.length; k++) { if (ms[k].kind !== 2) continue; const v = await rv('getVote', [t, BigInt(k)]); if (!v.open) continue;
      out.push({ token: t, milestone: k, description: ms[k].description, proofURI: v.proofURI, round: v.round, yes: v.yes, no: v.no, quorum: v.quorum, endsAt: new Date(Number(v.endsAt) * 1000).toISOString(), acceptingVotes: Number(v.endsAt) * 1000 > Date.now() }); } }
  return ok({ votes: out, how: 'Read the proof, judge honestly, then check_vote_eligibility + build_vote_tx. One vote per agent identity; team members cannot vote on their own token.' });
});
s.registerTool('check_vote_eligibility', { description: 'Can this wallet vote on this milestone now? Returns the reason if not.', inputSchema: { token: addr, milestone: z.number().int().min(0), wallet: addr } }, async ({ token, milestone, wallet }) => {
  const code = await rv('voteEligibility', [token, BigInt(milestone), wallet]);
  return ok({ eligible: code === 0, code, reason: ['eligible', 'no open vote', 'not a live registered agent on v2', 'identity registered too recently', 'wallet has not traded on AgentPad v2', 'team member of this token', 'this identity already voted this round'][code] });
});
s.registerTool('build_vote_tx', { description: 'Unsigned tx: cast your ONE vote (yes/no) on a VOTE milestone. Not token-weighted.', inputSchema: { token: addr, milestone: z.number().int().min(0), support: z.boolean() } }, async ({ token, milestone, support }) => vtx('vote', [token, BigInt(milestone), support]));
s.registerTool('build_claim_milestone_tx', { description: 'Unsigned tx (team members): claim a VOTE milestone as done with a proof link; opens the agent vote.', inputSchema: { token: addr, milestone: z.number().int().min(0), proofURI: z.string().min(1).max(280) } }, async ({ token, milestone, proofURI }) => vtx('claimMilestone', [token, BigInt(milestone), proofURI]));
s.registerTool('build_finalize_vote_tx', { description: 'Unsigned tx (anyone): close a vote after it ends. Passes with quorum and yes > no; otherwise the team can retry after a cooldown.', inputSchema: { token: addr, milestone: z.number().int().min(0) } }, async ({ token, milestone }) => vtx('finalizeVote', [token, BigInt(milestone)]));
s.registerTool('build_release_milestone_tx', { description: 'Unsigned tx (anyone): release a met milestone tranche to the team (after graduation + 3-day cliff).', inputSchema: { token: addr, milestone: z.number().int().min(0) } }, async ({ token, milestone }) => vtx('release', [token, BigInt(milestone)]));
s.registerTool('build_burn_expired_tx', { description: 'Unsigned tx (anyone): burn a failed tranche (deadline passed, or token did not graduate within 60 days).', inputSchema: { token: addr, milestone: z.number().int().min(0) } }, async ({ token, milestone }) => vtx('burnExpired', [token, BigInt(milestone)]));

// ---- 2.2.0 (add-only): one-call buy. Pass check -> ERC-8004 identity (if missing) -> AgentPad pass (if missing) -> buy, as ordered unsigned calls + EIP-5792 batch.
const KNOWN = { APBUILD: '0x673C578902c6cF868a1203cAc5637D94123Ef1F7', APAD: '0x73461e2647878F0058d6BC461165Aa7A99530Afd' };
const R8004 = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const GASL = { identity: 240000n, pass: 230000n, buy2: 300000n, buy1: 240000n }; // ~30% over fork-measured use
const RISK = 'AgentPad contracts are new and UNAUDITED. Curve tokens are tiny and illiquid and can go to zero; no profit is promised. 1% fee per trade. Sell back to the curve any time with no pass (build_sell_tx). Only buy what you are fine losing.';
async function resolveTok(q) {
  const s = String(q || 'APBUILD').trim(); if (isAddress(s)) return s; const k = s.toUpperCase(); if (KNOWN[k]) return KNOWN[k];
  for (const [P, A] of [[PAD, abi], [V1, v1abi]]) { const n = Number(await rd('tokenCount', [], P, A)); for (let i = 0; i < n; i++) { const t = await rd('allTokens', [BigInt(i)], P, A); const sym = await c.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' }).catch(() => ''); if (sym.toUpperCase() === k) return t; } }
  throw new Error('unknown token ' + s + ' (use APBUILD, APAD or a 0x address; see list_tokens)');
}
async function buildBuy({ wallet, token, eth, agentId, referrer, slippagePct = 3, agentURI }) {
  const t = await resolveTok(token); const v = await version(t); const P = v === 2 ? PAD : V1, A = v === 2 ? abi : v1abi;
  const cv = await rd('getCurve', [t], P, A); const symbol = await c.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' });
  if (cv.graduated) return { token: t, symbol, graduated: true, note: 'Graduated: trade it on Uniswap V2 (no pass needed).', dex: 'https://app.uniswap.org/swap?chain=base&outputCurrency=' + t };
  const ethIn = parseEther(String(eth)); if (ethIn <= 0n) throw new Error('eth must be > 0');
  const ref = referrer || DEFAULT_REF;
  const [isA, [out, fee], bal] = await Promise.all([rd('isAgent', [wallet], P, A), rd('quoteBuy', [t, ethIn], P, A), c.getBalance({ address: wallet })]);
  const minOut = slip(out, slippagePct); const calls = []; let identity = null;
  if (!isA) {
    let id;
    if (agentId !== undefined && agentId !== null && agentId !== '') {
      const owner = await c.readContract({ address: ERC8004, abi: R8004, functionName: 'ownerOf', args: [BigInt(agentId)] }).catch(() => null);
      if (!owner || owner.toLowerCase() !== wallet.toLowerCase()) throw new Error(`agentId ${agentId} is not owned by ${wallet} on ERC-8004 ${ERC8004}`);
      id = BigInt(agentId); identity = { status: 'owned', agentId: String(agentId) };
    } else {
      const uri = agentURI || 'https://agentpad-base.surge.sh/agent/agentpad-agent.json';
      const held = await c.readContract({ address: ERC8004, abi: R8004, functionName: 'balanceOf', args: [wallet] }).catch(() => 0n);
      id = (await c.simulateContract({ address: ERC8004, abi: R8004, functionName: 'register', args: [uri], account: wallet })).result;
      calls.push({ step: 'identity', to: ERC8004, data: encodeFunctionData({ abi: R8004, functionName: 'register', args: [uri] }), value: '0', gas: GASL.identity.toString() });
      identity = { status: 'mint', predictedAgentId: id.toString(), alreadyHolds: Number(held), note: (held > 0n ? 'You already hold an ERC-8004 id: pass agentId to skip the mint. ' : '') + 'agentId predicted by simulating register(); if another mint lands first the pass call reverts: re-run with agentId from your identity tx Transfer event.' };
    }
    calls.push({ step: 'pass', to: P, data: encodeFunctionData({ abi: A, functionName: 'registerViaERC8004', args: [id, ref] }), value: '0', gas: GASL.pass.toString() });
  }
  calls.push({ step: 'buy', to: P, data: encodeFunctionData({ abi: A, functionName: 'buy', args: [t, minOut, dl(1800)] }), value: ethIn.toString(), gas: (v === 2 ? GASL.buy2 : GASL.buy1).toString() });
  const hex = x => '0x' + BigInt(x).toString(16);
  return { chainId: 8453, wallet, token: t, symbol, version: v, isAgent: isA, identity, ethIn: String(eth), expectedTokens: formatUnits(out, 18), minTokensOut: formatUnits(minOut, 18), feeEth: formatEther(fee),
    txCount: calls.length, calls,
    sendCalls: { method: 'wallet_sendCalls', params: [{ version: '2.0.0', chainId: '0x2105', from: wallet, atomicRequired: true, calls: calls.map(x => ({ to: x.to, data: x.data, value: hex(x.value) })) }] },
    how: 'EOA: send calls in order, waiting for each receipt. Smart wallet (EIP-5792): send sendCalls as one atomic batch. Bankr: POST https://api.bankr.bot/wallet/submit {transaction:{to,chainId:8453,value,data}} per call, in order.',
    walletBalanceEth: formatEther(bal), approxGas: 'about $0.01 on Base for all calls', risk: RISK };
}
const buyIn = { wallet: addr.describe('your agent wallet (the one that will sign)'), token: z.string().optional().describe('APBUILD (default), APAD, or a 0x token address'), eth: z.string().describe('ETH to spend, e.g. "0.01"'),
  agentId: z.string().optional().describe('ERC-8004 agentId you already own (skips the identity mint)'), referrer: addr.optional(), slippagePct: z.number().min(0).max(50).optional() };
s.registerTool('agentpad_buy', { description: 'ONE tool to buy an AgentPad token (default APBUILD) on its bonding curve: checks your agent pass, and returns the ordered unsigned calls you need (ERC-8004 identity if missing -> AgentPad pass if missing -> buy) plus an EIP-5792 wallet_sendCalls batch. ~$0.01 gas on Base. Unaudited; no profit promised.', inputSchema: buyIn },
  async (a) => { const r = await buildBuy(a); return ok({ summary: r.graduated ? r.note : (r.isAgent ? 'You are an agent: 1 tx (buy).' : `${r.txCount} txs: ${r.calls.map(x => x.step).join(' -> ')} (or 1 atomic sendCalls batch on a smart wallet)`), ...r }); });
s.registerTool('onboard_and_buy', { description: 'Same as agentpad_buy, plus a custom ERC-8004 agentURI for the identity mint and per-call Bankr /wallet/submit bodies. Use when your wallet is new to AgentPad.', inputSchema: { ...buyIn, agentURI: z.string().url().optional().describe('your ERC-8004 registration file URL (default: a generic AgentPad one)') } },
  async (a) => { const r = await buildBuy(a); if (r.calls) r.bankr = r.calls.map(x => ({ endpoint: 'POST https://api.bankr.bot/wallet/submit', body: { transaction: { to: x.to, chainId: 8453, value: x.value, data: x.data }, description: 'AgentPad ' + x.step, waitForConfirmation: true } })); return ok(r); });

// add-only (Oct 24): honest volume + transparency, from the public AgentPad API (computed from on-chain Trade events + live contract reads)
const AP_API = process.env.AGENTPAD_API || 'https://agentpad.thevibehosting.com';
const getJ = async (path) => { const r = await fetch(AP_API + path); return r.json(); };
s.registerTool('honest_volume', { description: 'Honest AgentPad volume from real on-chain Trade events: gross volume, volume excluding each creator wallet, net ETH in (buys minus sells), unique trader wallets, and whether creators traded their own coin. Platform-wide plus per token. Optional token (symbol or 0x). Also (Oct 25): per-wallet net flow sorted by first trade block (trades, buys/sells, round_trip + repeats, pnl or "unknown"), independent wallet count, volume excluding the top wallet, last indexed block + exact event filter, curve balance read at a named block with a two-sided MISMATCH flag, fee reconciliation (fee events vs what the fee wallets received, matches true/false), creator_traded yes/no/not_traced, creator milestone log, and n (sample size) on every verdict.', inputSchema: { token: z.string().optional() } },
  async ({ token }) => { if (!token) return ok(await getJ('/v1/volume')); const t = await getJ('/v1/transparency?token=' + encodeURIComponent(token)); return ok({ token: t.token, honestVolume: t.honestVolume, balanceCheck: t.balanceCheck, mismatch: t.mismatch, feeReconciliation: t.feeReconciliation, creator_traded: t.creator_traded, creatorMilestoneLog: t.creatorMilestoneLog, indexing: t.indexing, verdicts: t.verdicts, error: t.error }); });
s.registerTool('token_transparency', { description: 'Where the money goes for an AgentPad token, read live from Base: creator fee wallets, platform feeRecipient (read from the contract), who can change it (owner), upgrade timelock + scheduled upgrades, Sourcify verification links, where the creator allocation sits and when it can unlock, where liquidity goes at graduation (Uniswap V2, LP locked), plus honest volume, per-wallet net flows, balance check at a named block with a two-sided MISMATCH flag, fee reconciliation (matches true/false), creator_traded yes/no/not_traced, creator milestone log (hit/burned/pending) and n on every verdict. Contracts are UNAUDITED.', inputSchema: { token: z.string().describe('symbol (APBUILD, APAD) or 0x token address') } },
  async ({ token }) => ok(await getJ('/v1/transparency?token=' + encodeURIComponent(token))));

await s.connect(new StdioServerTransport());
