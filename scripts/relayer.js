// Bidirectional bridge relayer: L1 PETHVault <-> PDOGE PDOGEBridge.
//
//   L1 -> PDOGE:  on PETHVault.Locked(user, amount)  -> bridge.mintWrapped(user, amount)
//   PDOGE -> L1:  on PDOGEBridge.BurnedForRelease(user, amount) -> vault.release(user, amount)
//
// Trust model (demo-grade, be honest about it):
//   - The operator key authorizes both sides. There are no validator sets,
//     no Merkle/state proofs, no fraud windows. The "proof" in v1 is the
//     event log itself, attested by the operator's signature on the relay tx.
//   - Processed tx hashes persist in relayer-state.json so restarts never
//     double-mint or double-release.
//
// Env: L1_RPC_URL, PDOGE_RPC_URL, OPERATOR_PRIVATE_KEY,
//      VAULT_ADDRESS, BRIDGE_ADDRESS. Optional: POLL_MS (default 10000).
// Run: node scripts/relayer.js
import dotenv from "dotenv";
dotenv.config();
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ethers } from "ethers";
import { Sender } from "./tx.js";

const L1_RPC = process.env.L1_RPC_URL || "";
const PDOGE_RPC = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546";
const KEY = process.env.OPERATOR_PRIVATE_KEY || "";
const VAULT = process.env.VAULT_ADDRESS || "";
const BRIDGE = process.env.BRIDGE_ADDRESS || "";
const RESERVE_VAULT = process.env.RESERVE_VAULT_ADDRESS || "";
const SBTC_REDEEM = process.env.SBTC_REDEEM_ADDRESS || "";
const SBTC = process.env.SBTC_ADDRESS || "";
const PDOGE_LOCK = process.env.PDOGE_LOCK_ADDRESS || "";
const PDOGE_TOKEN = process.env.PDOGE_TOKEN_ADDRESS || "";
const POLL_MS = parseInt(process.env.POLL_MS || "10000", 10);
const STATE_FILE = new URL("./relayer-state.json", import.meta.url);

if (!L1_RPC) throw new Error("Set L1_RPC_URL in .env");
if (!KEY) throw new Error("Set OPERATOR_PRIVATE_KEY in .env");
if (!ethers.isAddress(VAULT)) throw new Error("Set VAULT_ADDRESS in .env");
if (!ethers.isAddress(BRIDGE)) throw new Error("Set BRIDGE_ADDRESS in .env");

async function artifact(name) {
  const raw = await readFile(new URL(`../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url), "utf8");
  return JSON.parse(raw).abi;
}

async function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(await readFile(STATE_FILE, "utf8"));
  return { l1Block: null, pdogeBlock: null, processed: [] };
}
async function saveState(s) {
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

async function main() {
  const l1 = new ethers.JsonRpcProvider(L1_RPC);
  const pdoge = new ethers.JsonRpcProvider(PDOGE_RPC);
  const opL1 = new ethers.Wallet(KEY, l1);
  const opP = new ethers.Wallet(KEY, pdoge);
  const sendL1 = new Sender(l1, opL1);
  const sendP = new Sender(pdoge, opP);
  await sendL1.init();
  await sendP.init();

  const vaultAbi = await artifact("PETHVault");
  const bridgeAbi = await artifact("PDOGEBridge");
  const reserveAbi = RESERVE_VAULT ? await artifact("PETHReserveVault") : null;
  const redeemAbi = SBTC_REDEEM ? await artifact("SBTCRedeem") : null;
  const lockAbi = PDOGE_LOCK ? await artifact("PDOGELock") : null;
  const pdogeTokenAbi = PDOGE_TOKEN ? await artifact("PDOGEToken") : null;
  const sbtcAbi = ["function totalSupply() view returns (uint256)"];
  const vault = new ethers.Contract(VAULT, vaultAbi, opL1);
  const bridge = new ethers.Contract(BRIDGE, bridgeAbi, opP);

  const state = await loadState();
  const seen = new Set(state.processed);
  const warned = new Set(); // throttles repeat warnings for unprocessable events
  console.log(`Relayer live. L1 vault=${VAULT} PDOGE bridge=${BRIDGE}` + (RESERVE_VAULT ? ` reserve=${RESERVE_VAULT}` : ""));

  async function relayLocked() {
    const latest = await l1.getBlockNumber();
    const from = state.l1Block == null ? latest : state.l1Block + 1;
    if (from > latest) return;
    const events = await vault.queryFilter(vault.filters.Locked(), from, latest);
    for (const ev of events) {
      if (seen.has(ev.transactionHash)) continue;
      const { user, amount } = ev.args;
      console.log(`L1 Locked: ${ethers.formatUnits(amount, 18)} PETH from ${user} (tx ${ev.transactionHash})`);
      const b = new ethers.Contract(BRIDGE, bridgeAbi, opP);
      const tx = await b.mintWrapped.populateTransaction(user, amount);
      const rcpt = await sendP.send({ ...tx, to: BRIDGE });
      console.log(`  -> minted wPETH on PDOGE: ${rcpt.hash}`);
      seen.add(ev.transactionHash);
      state.processed.push(ev.transactionHash);
    }
    state.l1Block = latest;
    await saveState(state);
  }

  async function relayBurns() {
    const latest = await pdoge.getBlockNumber();
    const from = state.pdogeBlock == null ? latest : state.pdogeBlock + 1;
    if (from > latest) return;
    const events = await bridge.queryFilter(bridge.filters.BurnedForRelease(), from, latest);
    for (const ev of events) {
      if (seen.has(ev.transactionHash)) continue;
      const { user, amount } = ev.args;
      console.log(`PDOGE BurnedForRelease: ${ethers.formatUnits(amount, 18)} wPETH from ${user} (tx ${ev.transactionHash})`);
      const v = new ethers.Contract(VAULT, vaultAbi, opL1);
      const tx = await v.release.populateTransaction(user, amount);
      const rcpt = await sendL1.send({ ...tx, to: VAULT });
      console.log(`  -> released PETH on L1: ${rcpt.hash}`);
      seen.add(ev.transactionHash);
      state.processed.push(ev.transactionHash);
    }
    state.pdogeBlock = latest;
    await saveState(state);
  }

  // PDOGE -> L1: on SBTCRedeem.Redeemed(user, sbtcAmount) ->
  //   reserveVault.release(user, pethOut, sbtcAmount), pro-rata:
  //   pethOut = sbtcAmount * vaultReserve / sbtcTotalSupply.
  async function relayRedeems() {
    if (!RESERVE_VAULT || !SBTC_REDEEM || !SBTC) return;
    const latest = await pdoge.getBlockNumber();
    const from = state.redeemBlock == null ? latest : state.redeemBlock + 1;
    if (from > latest) return;
    const redeem = new ethers.Contract(SBTC_REDEEM, redeemAbi, opP);
    const events = await redeem.queryFilter(redeem.filters.Redeemed(), from, latest);
    for (const ev of events) {
      if (seen.has(ev.transactionHash)) continue;
      const { user, sbtcAmount } = ev.args;
      const rv = new ethers.Contract(RESERVE_VAULT, reserveAbi, opL1);
      const sbtc = new ethers.Contract(SBTC, sbtcAbi, pdoge);
      const [reserve, supply] = await Promise.all([rv.getReserveBalance(), sbtc.totalSupply()]);
      if (supply === 0n || reserve === 0n) {
        if (!warned.has(ev.transactionHash)) {
          console.log(`Redeemed event but reserve vault empty — will retry once funded (tx ${ev.transactionHash})`);
          warned.add(ev.transactionHash);
        }
        continue; // NOT marked processed: retried after the vault is funded
      }
      const pethOut = (sbtcAmount * reserve) / supply;
      if (pethOut === 0n) {
        seen.add(ev.transactionHash);
        state.processed.push(ev.transactionHash);
        continue;
      }
      console.log(`PDOGE Redeemed: ${ethers.formatUnits(sbtcAmount, 18)} sBTC from ${user} -> ${ethers.formatUnits(pethOut, 18)} PETH (tx ${ev.transactionHash})`);
      const tx = await rv.release.populateTransaction(user, pethOut, sbtcAmount);
      const rcpt = await sendL1.send({ ...tx, to: RESERVE_VAULT });
      console.log(`  -> released PETH on L1: ${rcpt.hash}`);
      seen.add(ev.transactionHash);
      state.processed.push(ev.transactionHash);
    }
    state.redeemBlock = latest;
    await saveState(state);
  }

  // PDOGE chain -> L1: on PDOGELock.Locked(user, amount) ->
  //   PDOGEToken.mint(user, amount) on mainnet.
  async function relayPdogeLocked() {
    if (!PDOGE_LOCK || !PDOGE_TOKEN) return;
    const latest = await pdoge.getBlockNumber();
    const from = state.pdogeLockBlock == null ? latest : state.pdogeLockBlock + 1;
    if (from > latest) return;
    const lock = new ethers.Contract(PDOGE_LOCK, lockAbi, opP);
    const events = await lock.queryFilter(lock.filters.Locked(), from, latest);
    for (const ev of events) {
      if (seen.has(ev.transactionHash)) continue;
      const { user, amount } = ev.args;
      console.log(`PDOGE Locked: ${ethers.formatUnits(amount, 18)} native PDOGE from ${user} (tx ${ev.transactionHash})`);
      const t = new ethers.Contract(PDOGE_TOKEN, pdogeTokenAbi, opL1);
      const tx = await t.mint.populateTransaction(user, amount);
      const rcpt = await sendL1.send({ ...tx, to: PDOGE_TOKEN });
      console.log(`  -> minted PDOGE on L1: ${rcpt.hash}`);
      seen.add(ev.transactionHash);
      state.processed.push(ev.transactionHash);
    }
    state.pdogeLockBlock = latest;
    await saveState(state);
  }

  // L1 -> PDOGE chain: on PDOGEToken.Burned(user, amount) ->
  //   PDOGELock.release(user, amount) on chain 42069.
  async function relayPdogeBurns() {
    if (!PDOGE_LOCK || !PDOGE_TOKEN) return;
    const latest = await l1.getBlockNumber();
    const from = state.pdogeTokenBlock == null ? latest : state.pdogeTokenBlock + 1;
    if (from > latest) return;
    const t = new ethers.Contract(PDOGE_TOKEN, pdogeTokenAbi, opL1);
    const events = await t.queryFilter(t.filters.Burned(), from, latest);
    for (const ev of events) {
      if (seen.has(ev.transactionHash)) continue;
      const { user, amount } = ev.args;
      console.log(`L1 Burned: ${ethers.formatUnits(amount, 18)} PDOGE from ${user} (tx ${ev.transactionHash})`);
      const lock = new ethers.Contract(PDOGE_LOCK, lockAbi, opP);
      const tx = await lock.release.populateTransaction(user, amount);
      const rcpt = await sendP.send({ ...tx, to: PDOGE_LOCK });
      console.log(`  -> released native PDOGE on 42069: ${rcpt.hash}`);
      seen.add(ev.transactionHash);
      state.processed.push(ev.transactionHash);
    }
    state.pdogeTokenBlock = latest;
    await saveState(state);
  }

  for (;;) {
    try { await relayLocked(); } catch (e) { console.error("L1 poll error:", e.message || e); }
    try { await relayBurns(); } catch (e) { console.error("PDOGE poll error:", e.message || e); }
    try { await relayRedeems(); } catch (e) { console.error("redeem poll error:", e.message || e); }
    try { await relayPdogeLocked(); } catch (e) { console.error("pdoge-lock poll error:", e.message || e); }
    try { await relayPdogeBurns(); } catch (e) { console.error("pdoge-token poll error:", e.message || e); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
