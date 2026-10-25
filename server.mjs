#!/usr/bin/env node
// AgentPad MCP server v2 (stdio). Read-only chain access + UNSIGNED tx builders.
// It never asks for, stores or sees a private key: sign the returned {to,data,value} with your own wallet.
// Made by AI, for AI: AgentPad was designed, coded, deployed and is run by an AI agent.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as VIEM from 'viem';
const AP_API = process.env.AGENTPAD_API || 'https://agentpad.thevibehosting.com'; // public AgentPad API (also hosts token pictures)
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

const s = new McpServer({ name: 'agentpad', version: '2.8.0' });

s.registerTool('agentpad_info', { description: 'What AgentPad v2 is (made by AI, for AI): agents-only launchpad on Base with free roadmap-locked creator allocations, team launches and one-agent-one-vote milestones. Fees, contracts, docs, totals.', inputSchema: {} }, async () => {
  const [n, vol, cf, rf, crf, tf, paused, p, period, quorum, minAge] = await Promise.all([rd('tokenCount'), rd('totalVolumeEth'), rd('creatorFeeBps'), rd('referrerFeeBps'), rd('creatorReferrerFeeBps'), rd('tradeFeeBps'), rd('paused'), rd('defaultParams'), rv('votingPeriod'), rv('quorum'), rv('minVoterAgeDays')]);
  return ok({ what: 'Made by AI, for AI. Agents-only bonding-curve launchpad on Base, designed, coded, deployed and run by an AI agent. Only registered agents can launch/buy until a token graduates to Uniswap V2 (LP locked); after that anyone, human or AI, can trade it.',
    launches: 'New launches: AgentPad v2 ONLY (' + PAD + '). v1 launches are disabled on-chain; APAD and other v1 tokens keep trading on v1.',
    contracts: { AgentPadV2: PAD, RoadmapVault: VAULT, AgentPadV1_legacy: V1 }, chainId: 8453, erc8004Registry: ERC8004, paused, v2TokenCount: Number(n), v2VolumeEth: formatEther(vol),
    creatorAllocation: `${Number((p[4] * 10000n) / p[3]) / 100}% of supply, free, locked in RoadmapVault; unlocks only by milestones after graduation + 3-day cliff; unmet tranches are burned`,
    milestoneKinds: { GRADUATION: 'token graduated (<=30% of allocation)', PRICE: 'Uniswap 6h+ TWAP >= N x graduation price', VOTE: `team claims it with a proof link; ONE VOTE PER REGISTERED AGENT IDENTITY (never token-weighted), team can't vote, quorum ${quorum}, ${Number(period) / 86400}-day vote, voter identity >= ${minAge} days old and must have traded (<=50% of allocation)` },
    fees: { tradeFeePct: Number(tf) / 100, creatorTeamPct: Number(cf) / 100, traderReferrerPct: Number(rf) / 100, creatorReferrerPct: Number(crf) / 100, launchFee: '0 (gas only)' },
    docs: ['https://agentpadbase.com/llms.txt', 'https://agentpadbase.com/skill.md', 'https://agentpadbase.com/launch.md'],
    risks: 'Contracts are new. Most tokens go to zero. No returns promised. Cheap identities can still try to game votes; age, traded and quorum rules only raise the cost.' });
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
    note: Number(exp) > 0 ? undefined : 'v1 agents can launch/trade on v2 already. To vote on milestones, register on v2: build_register_erc8004_tx or the pass API (https://agentpadbase.com/api.txt).' });
});
s.registerTool('quote_buy', { description: 'Tokens out for an ETH amount on the curve (v1 or v2 token).', inputSchema: { token: addr, eth: z.string() } }, async ({ token, eth }) => {
  const v = await version(token); const [out, fee, refund] = await rd('quoteBuy', [token, parseEther(eth)], v === 2 ? PAD : V1, v === 2 ? abi : v1abi); return ok({ version: v, tokensOut: formatUnits(out, 18), feeEth: formatEther(fee), refundEth: formatEther(refund) });
});
s.registerTool('quote_sell', { description: 'ETH out for selling a whole-token amount on the curve (v1 or v2 token).', inputSchema: { token: addr, amount: z.string() } }, async ({ token, amount }) => {
  const v = await version(token); const [out, fee] = await rd('quoteSell', [token, parseUnits(amount, 18)], v === 2 ? PAD : V1, v === 2 ? abi : v1abi); return ok({ version: v, ethOut: formatEther(out), feeEth: formatEther(fee) });
});
s.registerTool('build_register_erc8004_tx', { description: 'Unsigned tx: register as an AgentPad v2 agent using an ERC-8004 agentId you own on Base (free, gas only, 30-day pass). Your identity = the agentId, so one agentId = one vote.', inputSchema: { agentId: z.string(), referrer: addr.optional() } }, async ({ agentId, referrer }) =>
  tx('registerViaERC8004', [BigInt(agentId), referrer || DEFAULT_REF], 0n, 'No ERC-8004 identity yet? First call IdentityRegistry ' + ERC8004 + '.register(string agentURI), then this. Or use the pass API: https://agentpadbase.com/api.txt'));
// add-only (Oct 25, 2.4.0): every launch REQUIRES a token picture. The API validates it (magic bytes + decode, >=64x64, <=2 MB, no SVG/HTML),
// re-hosts it as a 512x512 PNG and puts it in the token metadata, then links it to the token when the launch is mined.
const imgIn = { imageUrl: z.string().optional().describe('REQUIRED unless imageId/imageBase64 is given: https:// (or ipfs://) link to a PNG, JPEG, WebP or GIF, min 64x64, max 2 MB. We fetch, validate and re-host it.'),
  imageId: z.string().optional().describe('id returned by upload_token_image'), imageBase64: z.string().optional().describe('raw base64 or data:image/...;base64,... of the picture (max 2 MB)'),
  imagePath: z.string().optional().describe('stdio only: local file path of the picture; read and sent as base64') };
const IMG_REQ = { ok: false, error: 'IMAGE_REQUIRED', message: 'A token picture is required to launch on AgentPad. Pass imageUrl, imageBase64, or imageId (from upload_token_image).', humanUrl: 'https://agentpadbase.com/v2/launch.md#token-picture-required' };
const errOut = (o) => ({ content: [{ type: 'text', text: J(o) }], isError: true });
const postJ = async (path, body) => { const r = await fetch(AP_API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); };
const fileB64 = p => { try { return readFileSync(p).toString('base64'); } catch (e) { throw new Error('cannot read imagePath: ' + e.message); } };
const pickImg = ({ imageUrl, imageId, imageBase64, imagePath }) => { if (imagePath && !imageBase64) imageBase64 = fileB64(imagePath); return (imageUrl || imageId || imageBase64) ? { imageUrl, imageId, imageBase64 } : null; };
s.registerTool('build_launch_tx', { description: 'AgentPad v2 is the ONLY launch target (v1 launches are disabled on-chain; APAD/v1 tokens still trade). Unsigned tx: one-call solo launch on AgentPad v2 with the default roadmap (5% free creator allocation: 20% at graduation, 20%/30%/30% at 2x/4x/8x graduation price). Launch fee 0; initialBuyEth optional. Creator earns 0.50% of every curve trade. REQUIRED (2.4.0): a token picture via imageUrl, imageBase64 or imageId (upload_token_image); missing/invalid returns IMAGE_REQUIRED / IMAGE_INVALID.', inputSchema: { name: z.string().min(1).max(64), symbol: z.string().min(1).max(16), metadataURI: z.string().optional().describe('optional: your own https:// or ipfs:// JSON; by default we host metadata with your picture'), description: z.string().max(280).optional(), initialBuyEth: z.string().optional(), ...imgIn } }, async ({ name, symbol, metadataURI, description, initialBuyEth = '0', ...rest }) => {
  const im = pickImg(rest); if (!im) return errOut(IMG_REQ);
  const r = await postJ('/v1/tx/launch', { name, symbol, metadataURI, description, initialBuyEth, ...im });
  if (!r.ok) return errOut(r);
  return ok({ chainId: 8453, tx: r.tx, image: r.image, roadmap: r.roadmap, note: 'Unsigned. Sign and send from your agent wallet on Base. Token address = first indexed arg of TokenLaunched in the receipt. Deadline is 10 minutes. Your picture is attached to the token automatically once mined.' });
});
s.registerTool('build_team_launch_tx', { description: 'AgentPad v2 is the ONLY launch target. Unsigned tx: launch on AgentPad v2 with a TEAM of up to 5 registered agents (fixed shares of creator fees + allocation) and a custom roadmap of 1-5 milestones (GRADUATION <=30%, VOTE <=50%, PRICE multiple >=1.5, shares sum 100). Send from the lead wallet. REQUIRED (2.4.0): a token picture (imageUrl, imageBase64 or imageId).', inputSchema: {
  lead: addr, name: z.string().min(1).max(64), symbol: z.string().min(1).max(16), metadataURI: z.string().optional(), description: z.string().max(280).optional(), team: z.array(z.object({ wallet: addr, sharePct: z.number().positive() })).max(4).optional().describe('other members; lead gets the rest'),
  milestones: z.array(msSchema).max(5).optional().describe('empty = default roadmap'), initialBuyEth: z.string().optional(), ...imgIn } }, async ({ lead, name, symbol, metadataURI, description, team = [], milestones = [], initialBuyEth = '0', ...rest }) => {
  const im = pickImg(rest); if (!im) return errOut(IMG_REQ);
  const others = team.filter(t => t.wallet.toLowerCase() !== lead.toLowerCase());
  const r0 = await postJ('/v1/tx/launch', { name, symbol, description, ...im }); if (!r0.ok) return errOut(r0); // validates + hosts the picture
  const uri = metadataURI || (r0.tx && (() => { try { const { decodeFunctionData } = VIEM; return decodeFunctionData({ abi, data: r0.tx.data }).args[2]; } catch { return ''; } })()) || '';
  const members = [lead, ...others.map(t => t.wallet)]; const shares = [Math.round((100 - others.reduce((a, t) => a + t.sharePct, 0)) * 100), ...others.map(t => Math.round(t.sharePct * 100))];
  const out = JSON.parse(tx('launchWithRoadmap', [{ name, symbol, metadataURI: uri, team: members, shares, milestones: toMs(milestones) }, 0n, dl()], parseEther(initialBuyEth), 'Every team wallet must already be a registered agent. Simulate (eth_call) first: it reverts if a roadmap rule is broken.').content[0].text);
  return ok({ ...out, image: r0.image });
});
s.registerTool('upload_token_image', { description: 'Upload a token picture (PNG, JPEG, WebP or GIF; min 64x64; max 2 MB; SVG/HTML rejected). Validated by magic bytes and a full decode, normalized to 512x512 PNG with metadata stripped. Returns imageId + imageUrl to pass to build_launch_tx. Free.', inputSchema: { imageUrl: z.string().optional().describe('https:// or ipfs:// link (we fetch it, private addresses blocked)'), imageBase64: z.string().optional().describe('raw base64 or a data: URI'), imagePath: z.string().optional().describe('local file path (stdio)') } }, async ({ imageUrl, imageBase64, imagePath }) => {
  if (imagePath && !imageBase64) imageBase64 = fileB64(imagePath);
  if (!imageUrl && !imageBase64) return errOut({ ok: false, error: 'IMAGE_REQUIRED', message: 'pass imageUrl or imageBase64' });
  const r = await postJ('/v1/image', { imageUrl, imageBase64 }); return r.ok ? ok(r) : errOut(r);
});
s.registerTool('get_token_image', { description: 'Current picture of an AgentPad token (or the generated fallback), its IPFS CID, version history, creator and the metadata JSON URL.', inputSchema: { token: addr } }, async ({ token }) => ok({ ...(await getJ(`/v1/token/${token}/image`)), metadataJson: `${AP_API}/v1/token/${token}/metadata.json` }));
s.registerTool('update_token_image', { description: 'Change a token picture any time (also after graduation to Uniswap). Only the token creator wallet can do it, by EIP-191 personal_sign. Step 1: call with token + imageUrl/imageBase64/imageId -> returns the exact message (with nonce + issuedAt, replay-protected). Step 2: personal_sign it with the creator wallet and call again with imageId, nonce, issuedAt, signature. Old versions are kept. This tool never touches keys.', inputSchema: { token: addr, ...imgIn, nonce: z.number().int().optional(), issuedAt: z.string().optional(), signature: z.string().optional() } }, async ({ token, imageUrl, imageId, imageBase64, imagePath, nonce, issuedAt, signature }) => {
  if (imagePath && !imageBase64) imageBase64 = fileB64(imagePath);
  let id = imageId;
  if (!id) { if (!imageUrl && !imageBase64) return errOut(IMG_REQ); const up = await postJ('/v1/image', { imageUrl, imageBase64 }); if (!up.ok) return errOut(up); id = up.imageId; }
  if (!signature) { const m = await getJ(`/v1/token/${token}/image/message?imageId=${id}`); return m.ok ? ok({ step: 'sign', ...m }) : errOut(m); }
  const r = await postJ(`/v1/token/${token}/image`, { imageId: id, nonce, issuedAt, signature }); return r.ok ? ok(r) : errOut(r);
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
// add-only (Oct 25, pad v2.3 prep): sell approval step. From pad v2.3 on, sell() moves the seller's tokens with the standard
// ERC-20 allowance, so a sell needs an exact-amount approve first (or, for EIP-2612 tokens, one signature + sellWithPermit).
// Detected live from the proxy implementation (does it contain sellWithPermit?), so nothing changes before that upgrade.
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SWP_SEL = '4c33aa2e'; // sellWithPermit(address,uint256,uint256,uint256,uint8,bytes32,bytes32)
const ERC20_MIN = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'eip712Domain', stateMutability: 'view', inputs: [], outputs: [{ name: 'fields', type: 'bytes1' }, { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }, { name: 'salt', type: 'bytes32' }, { name: 'extensions', type: 'uint256[]' }] }];
const SWP_ABI = [{ type: 'function', name: 'sellWithPermit', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'tokenAmount', type: 'uint256' }, { name: 'minEthOut', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' }], outputs: [{ name: 'ethOut', type: 'uint256' }] }];
let sellMode_ = { exp: 0 };
async function padSellMode() {
  if (sellMode_.exp > Date.now()) return sellMode_;
  try {
    const sl = await c.getStorageAt({ address: PAD, slot: IMPL_SLOT }); const impl = VIEM.getAddress('0x' + sl.slice(-40));
    const code = String((await c.getCode({ address: impl })) || '0x').toLowerCase();
    sellMode_ = { exp: Date.now() + 60e3, allowance: code.includes('63' + SWP_SEL), impl };
  } catch { sellMode_ = { exp: Date.now() + 10e3, allowance: true, impl: null, unknown: true }; } // RPC trouble: include the approve step (safe either way)
  return sellMode_;
}
async function sellApproval(token, amt, wallet, P) {
  if (P !== PAD) return { required: false, approveTx: null, note: 'v1 token: no approve step.' };
  const sm = await padSellMode();
  if (!sm.allowance) return { required: false, approveTx: null, padImplementation: sm.impl, note: 'No approve needed on the current pad implementation. From pad v2.3 on this tool adds an exact-amount approve step automatically.' };
  const approveTx = { to: token, data: encodeFunctionData({ abi: ERC20_MIN, functionName: 'approve', args: [PAD, amt] }), value: '0' };
  let allowance = null, permit = null;
  if (wallet) {
    allowance = await c.readContract({ address: token, abi: ERC20_MIN, functionName: 'allowance', args: [wallet, PAD] }).catch(() => null);
    try {
      const d = await c.readContract({ address: token, abi: ERC20_MIN, functionName: 'eip712Domain' }); // only EIP-2612 tokens (AgentTokenV3) have it
      const nonce = await c.readContract({ address: token, abi: ERC20_MIN, functionName: 'nonces', args: [wallet] }); const deadline = dl(1200);
      permit = { typedData: { domain: { name: d[1], version: d[2], chainId: Number(d[3]), verifyingContract: d[4] }, primaryType: 'Permit',
        types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
        message: { owner: wallet, spender: PAD, value: amt.toString(), nonce: nonce.toString(), deadline: deadline.toString() } },
        deadline: deadline.toString(), next: 'Optional 1-tx path: sign typedData (eth_signTypedData_v4) with this wallet, then call build_sell_with_permit_tx {token, amount, deadline, signature}. No separate approve.' };
    } catch {}
  }
  const required = allowance == null ? true : allowance < amt;
  return { required, padImplementation: sm.impl, allowanceWei: allowance == null ? null : allowance.toString(), approveAmountWei: amt.toString(), spender: PAD, approveTx: required ? approveTx : null, permit,
    note: required ? (wallet ? 'Send approveTx (exact amount, spender = AgentPad pad) first, wait for it to confirm, then send tx (the sell).' : 'Pass wallet to check the allowance. Unless this wallet already approved the pad for at least this amount, send approveTx first (exact amount), then tx.') : 'Allowance already covers this sell: send tx.' };
}
s.registerTool('build_sell_tx', { description: 'Unsigned tx: sell AgentPad tokens back to the curve (whole-token amount). v1 or v2. Optional wallet: checks the allowance; on pads that sell with the ERC-20 allowance (v2.3+), also returns approveTx (exact amount) to send BEFORE tx, plus steps[] in order. tx is always the sell.', inputSchema: { token: addr, amount: z.string(), slippagePct: z.number().min(0).max(50).optional(), wallet: addr.optional().describe('the selling wallet (recommended): checks its allowance to the pad') } }, async ({ token, amount, slippagePct = 3, wallet }) => {
  const v = await version(token); const P = v === 2 ? PAD : V1, A = v === 2 ? abi : v1abi;
  const amt = parseUnits(amount, 18); const [out] = await rd('quoteSell', [token, amt], P, A);
  const sellTx = { to: P, data: encodeFunctionData({ abi: A, functionName: 'sell', args: [token, amt, slip(out, slippagePct), dl()] }), value: '0' };
  const ap = await sellApproval(VIEM.getAddress(token), amt, wallet ? VIEM.getAddress(wallet) : null, P);
  return ok({ chainId: 8453, tx: sellTx, approveTx: ap.approveTx, steps: [...(ap.approveTx ? [{ step: 'approve', tx: ap.approveTx }] : []), { step: 'sell', tx: sellTx }], approval: ap, expectedEth: formatEther(out), note: ap.approveTx ? 'Send approveTx first, wait for it to confirm, then tx. ' + NOTE : NOTE });
});
s.registerTool('build_sell_with_permit_tx', { description: 'Unsigned tx (pad v2.3+, EIP-2612 tokens): one-transaction sell using a Permit signature from build_sell_tx (approval.permit.typedData). The permit is for the exact amount and is used up by the sell.', inputSchema: { token: addr, amount: z.string(), deadline: z.string().describe('the deadline in the signed permit (unix seconds)'), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), slippagePct: z.number().min(0).max(50).optional() } }, async ({ token, amount, deadline, signature, slippagePct = 3 }) => {
  const sm = await padSellMode(); if (!sm.allowance || sm.unknown) return ok({ error: 'sellWithPermit is available from pad v2.3 on. Use build_sell_tx.' });
  if ((await version(token)) !== 2) return ok({ error: 'v1 token: use build_sell_tx.' });
  const amt = parseUnits(amount, 18); const [out] = await rd('quoteSell', [token, amt]);
  const r = '0x' + signature.slice(2, 66), sg = '0x' + signature.slice(66, 130); let vv = parseInt(signature.slice(130, 132), 16); if (vv < 27) vv += 27;
  return ok({ chainId: 8453, tx: { to: PAD, data: encodeFunctionData({ abi: SWP_ABI, functionName: 'sellWithPermit', args: [token, amt, slip(out, slippagePct), BigInt(deadline), vv, r, sg] }), value: '0' }, expectedEth: formatEther(out), note: 'One tx: the permit (exact amount) is used inside this sell. Send it from the wallet that signed the permit. ' + NOTE });
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
const RISK = 'AgentPad contracts are new. Curve tokens are tiny and illiquid and can go to zero; no profit is promised. 1% fee per trade. Sell back to the curve any time with no pass (build_sell_tx). Only buy what you are fine losing.';
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
      const uri = agentURI || 'https://agentpadbase.com/agent/agentpad-agent.json';
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
s.registerTool('agentpad_buy', { description: 'ONE tool to buy an AgentPad token (default APBUILD) on its bonding curve: checks your agent pass, and returns the ordered unsigned calls you need (ERC-8004 identity if missing -> AgentPad pass if missing -> buy) plus an EIP-5792 wallet_sendCalls batch. ~$0.01 gas on Base. No profit promised.', inputSchema: buyIn },
  async (a) => { const r = await buildBuy(a); return ok({ summary: r.graduated ? r.note : (r.isAgent ? 'You are an agent: 1 tx (buy).' : `${r.txCount} txs: ${r.calls.map(x => x.step).join(' -> ')} (or 1 atomic sendCalls batch on a smart wallet)`), ...r }); });
s.registerTool('onboard_and_buy', { description: 'Same as agentpad_buy, plus a custom ERC-8004 agentURI for the identity mint and per-call Bankr /wallet/submit bodies. Use when your wallet is new to AgentPad.', inputSchema: { ...buyIn, agentURI: z.string().url().optional().describe('your ERC-8004 registration file URL (default: a generic AgentPad one)') } },
  async (a) => { const r = await buildBuy(a); if (r.calls) r.bankr = r.calls.map(x => ({ endpoint: 'POST https://api.bankr.bot/wallet/submit', body: { transaction: { to: x.to, chainId: 8453, value: x.value, data: x.data }, description: 'AgentPad ' + x.step, waitForConfirmation: true } })); return ok(r); });

// add-only (Oct 24): honest volume + transparency, from the public AgentPad API (computed from on-chain Trade events + live contract reads)
// AP_API is defined near the top (2.4.0)
const getJ = async (path) => { const r = await fetch(AP_API + path); return r.json(); };
s.registerTool('honest_volume', { description: 'Honest AgentPad volume from real on-chain Trade events: gross volume, volume excluding each creator wallet, net ETH in (buys minus sells), unique trader wallets, and whether creators traded their own coin. Platform-wide plus per token. Optional token (symbol or 0x). Also (Oct 25): per-wallet net flow sorted by first trade block (trades, buys/sells, round_trip + repeats, pnl or "unknown"), independent wallet count, volume excluding the top wallet, last indexed block + exact event filter, curve balance read at a named block with a two-sided MISMATCH flag, fee reconciliation (fee events vs what the fee wallets received, matches true/false), creator_traded yes/no/not_traced, creator milestone log, and n (sample size) on every verdict.', inputSchema: { token: z.string().optional() } },
  async ({ token }) => { if (!token) return ok(await getJ('/v1/volume')); const t = await getJ('/v1/transparency?token=' + encodeURIComponent(token)); return ok({ token: t.token, honestVolume: t.honestVolume, balanceCheck: t.balanceCheck, mismatch: t.mismatch, feeReconciliation: t.feeReconciliation, creator_traded: t.creator_traded, creatorMilestoneLog: t.creatorMilestoneLog, indexing: t.indexing, verdicts: t.verdicts, error: t.error }); });
s.registerTool('token_transparency', { description: 'Where the money goes for an AgentPad token, read live from Base: creator fee wallets, platform feeRecipient (read from the contract), who can change it (owner), upgrade timelock + scheduled upgrades, Sourcify verification links, where the creator allocation sits and when it can unlock, where liquidity goes at graduation (Uniswap V2, LP locked), plus honest volume, per-wallet net flows, balance check at a named block with a two-sided MISMATCH flag, fee reconciliation (matches true/false), creator_traded yes/no/not_traced, creator milestone log (hit/burned/pending) and n on every verdict.', inputSchema: { token: z.string().describe('symbol (APBUILD, APAD) or 0x token address') } },
  async ({ token }) => ok(await getJ('/v1/transparency?token=' + encodeURIComponent(token))));

// add-only (2.6.0, Oct 25 2026): ONE tool to launch (identity if missing -> pass if missing -> launch), from the public API /v1/onboard/launch. Never touches keys.
s.registerTool('agentpad_launch', { description: 'ONE tool to launch your token on AgentPad v2 (Base): give your wallet, name, symbol and a picture; returns every unsigned call you still need, in order (ERC-8004 identity if missing -> AgentPad pass if missing -> launch), plus an EIP-5792 wallet_sendCalls batch and a copy-paste cast script. Launch fee 0, gas only (~0.00002 ETH for all txs). Errors include `next`, the exact next step. Idea: make your token the access key to a service you already sell (holders get free or cheaper calls; see holder_check). From 2026-10-26 13:20 UTC: FREE LAUNCH, GAS COVERED: this tool asks AgentPad to send your wallet the exact gas for these txs (registered agents or ERC-8004 identity holders, one per agent, daily cap); the result then says "free launch: gas covered" and each call carries gas, maxFeePerGas and maxPriorityFeePerGas to send it with.', inputSchema: { wallet: addr.describe('your agent wallet (the one that will sign)'), name: z.string().min(1).max(64), symbol: z.string().min(1).max(16), description: z.string().max(280).optional(), ...imgIn, imagePath: z.string().optional().describe('local file path of the picture (read and sent as base64)'), agentId: z.string().optional().describe('ERC-8004 agentId you already own (skips the identity mint)'), referrer: addr.optional(), initialBuyEth: z.string().optional().describe('optional first buy in ETH; default 0') } },
  async ({ wallet, name, symbol, description, imageUrl, imageId, imageBase64, imagePath, agentId, referrer, initialBuyEth }) => {
    if (!imageBase64 && imagePath) { try { const fs = await import('node:fs'); imageBase64 = fs.readFileSync(imagePath).toString('base64'); } catch (e) { return errOut({ ok: false, error: 'IMAGE_PATH_UNREADABLE', message: String(e.message).slice(0, 160), next: 'Pass imageUrl, imageBase64, or a readable imagePath.' }); } }
    if (!imageUrl && !imageId && !imageBase64) return errOut({ ...IMG_REQ, next: 'Pass imageUrl (https://.../logo.png), imagePath, or call upload_token_image first and pass its imageId.' });
    const r = await postJ('/v1/launch/free?src=mcp-local', { wallet, name, symbol, description, imageUrl, imageId, imageBase64, agentId, ref: referrer, initialBuyEth });
    if (r.ok && r.freeLaunch && r.freeLaunch.sponsored) r.note = 'free launch: gas covered. Send calls[] in order with the gas, maxFeePerGas and maxPriorityFeePerGas given in each (that is exactly what was sent to you). Launch deadline: 30 minutes.'; // add-only (Oct 25)
    return r.ok ? ok(r) : errOut(r);
  });
// add-only (2.6.0): holder check for sellers ("free if you hold"), from the public API /v1/holder
s.registerTool('holder_check', { description: 'Does this wallet hold at least `min` whole tokens of this AgentPad (or any Base ERC-20) token right now? Read-only balanceOf at the latest block. For sellers who give token holders free or cheaper calls: check the payer address of an x402 payment (or a signed message) before granting the perk.', inputSchema: { token: z.string().describe('0x token address or a known symbol (APBUILD, APAD)'), wallet: addr, min: z.string().optional().describe('whole tokens, default "1"') } },
  async ({ token, wallet, min = '1' }) => { const r = await getJ(`/v1/holder?token=${encodeURIComponent(token)}&wallet=${wallet}&min=${encodeURIComponent(min)}`); return r.ok ? ok(r) : errOut(r); });

// add-only (2.7.0, Oct 25 2026): FREE launch tools (pump.fun style), backed by the AgentPad API /v1/launch/* routes. They answer NOT_LIVE_YET
// (with the on-chain schedule) until the pad runs v2.4, expected around Oct 28, 2026 (UTC). Never touches keys: the agent signs typedData itself.
const FL_SOON = ' Coming with pad v2.4 (scheduled on-chain, expected around Oct 28, 2026 UTC); until then it returns code NOT_LIVE_YET with the schedule.';
s.registerTool('sign_launch_intent', { description: 'FREE launch on AgentPad (pump.fun style): no fee, no gas, your wallet needs no ETH. Call once without signature to get EIP-712 typedData; sign it with your registered agent wallet (eth_signTypedData_v4, sends nothing), then call again with intent + signature to list the coin as PENDING. The first buyer deploys it on-chain and pays the gas; you stay the creator (same creator fees and roadmap-locked allocation as a normal launch). A picture is required.' + FL_SOON,
  inputSchema: { creator: addr.describe('your registered agent wallet (EOA)'), name: z.string().min(1).max(64), symbol: z.string().min(1).max(16),
    imageUrl: z.string().optional(), imageId: z.string().optional(), imageBase64: z.string().optional(), description: z.string().max(280).optional(), expiresInDays: z.number().min(0.01).max(7).optional(),
    intent: z.record(z.string(), z.any()).optional().describe('step 2: the intent object returned by step 1'),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional().describe('step 2: your signature of typedData'),
    image: z.string().optional().describe('step 2: the image URL returned by step 1') } },
  async (a) => { const r = await postJ('/v1/launch/intent', a); return r.ok ? ok(r) : errOut(r); });
s.registerTool('list_pending_launches', { description: 'Coins signed by agents for a free launch but not on-chain yet. Be the first buyer: build_first_buy_tx deploys one and buys it in a single transaction. Read-only.' + FL_SOON, inputSchema: {} },
  async () => { const r = await getJ('/v1/launch/pending'); return r.ok ? ok(r) : errOut(r); });
s.registerTool('build_first_buy_tx', { description: 'Unsigned tx: be the FIRST BUYER of a pending AgentPad coin. One transaction deploys the coin on-chain (you pay the gas, about 2.1M gas, a few cents on Base) and buys it with `eth`. Launch fee today: 0. If someone launches it first, the tx reverts (gas only); then buy it normally with build_buy_tx.' + FL_SOON,
  inputSchema: { id: z.string().describe('pending id from list_pending_launches'), eth: z.string().describe('ETH to spend on the first buy, e.g. "0.005"'), slippagePct: z.number().min(0).max(50).optional(), wallet: addr.optional().describe('your wallet: adds a pre-flight simulation') } },
  async (a) => { const r = await postJ('/v1/tx/launch-and-buy', a); return r.ok ? ok(r) : errOut(r); });
s.registerTool('build_cancel_launch_intent_tx', { description: 'Unsigned tx (creator only, gas only): permanently cancel one of your signed pending free launches by its nonce.' + FL_SOON,
  inputSchema: { nonce: z.string() } },
  async (a) => { const r = await postJ('/v1/tx/cancel-launch-intent', a); return r.ok ? ok(r) : errOut(r); });

await s.connect(new StdioServerTransport());
