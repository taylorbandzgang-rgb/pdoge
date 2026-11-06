// Collects full PDOGE + mainnet state for the dashboard snapshot.
// Outputs JSON to stdout. Run: node scripts/dashboard-snapshot.js
import { ethers } from "ethers";
import fs from "node:fs";
import { execSync } from "node:child_process";

// Post-GCE-migration: the PDOGE chain runs on the GCE VM pdoge-node
// (34.148.123.122); local services were retired at cutover (2026-11-04).
const PDOGE_RPC = "https://34.148.123.122.nip.io/";
const L1_RPC = "https://ethereum-rpc.publicnode.com";

function env(k) {
  const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${k}=(.+)$`, "m"));
  if (!m) throw new Error("missing " + k);
  return m[1].trim();
}

const PHANTOM = "0x1bbae640072033ee04414d1e980dca180b6aef75";
const BRIDGE_USER = env("BRIDGE_USER_ADDRESS");
const SAVINGS = "0xd42F201ed7502D7AF699E2F523590567899a1Ae9"; // savings wallet (address derived from SAVINGS_PRIVATE_KEY)
const OPERATOR = env("OPERATOR_ADDRESS");
const WPETH_PDOGE = env("WPETH_ADDRESS");
const STAKING = env("STAKING_ADDRESS");
const WPAIR = env("PAIR_ADDRESS");
const SBTC = env("SBTC_ADDRESS");
const SBTC_PAIR = env("SBTC_PAIR_ADDRESS");
const VAULT = env("VAULT_ADDRESS");
const PETH = "0x34fDfEf7F661e95B10F821173763cd4C0d1974ca";
const UNI_PAIR = "0x93333653a1E61C9F3C573165aa8f9C394d457E3f";

const f2 = (v) => Number(ethers.formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const f6 = (v) => Number(ethers.formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 6 });

// Per-service systemd status; never throws — a missing unit is reported, not masked.
function svcStatus(name) {
  try {
    const s = execSync(`systemctl is-active ${name}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    return s || "unknown";
  } catch {
    try {
      execSync(`systemctl cat ${name} --no-pager`, { stdio: ["ignore", "ignore", "ignore"] });
      return "inactive"; // unit installed but not active
    } catch {
      return "not installed";
    }
  }
}

async function main() {
  const pdoge = new ethers.JsonRpcProvider(PDOGE_RPC);
  const l1 = new ethers.JsonRpcProvider(L1_RPC);
  const out = { updatedAt: new Date().toISOString() };

  // --- PDOGE chain ---
  out.chain = { id: 42069, block: await pdoge.getBlockNumber() };

  const staking = new ethers.Contract(STAKING, [
    "function totalSupply() view returns (uint256)",
    "function rewardRate() view returns (uint256)",
    "function earned(address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function periodFinish() view returns (uint256)",
  ], pdoge);
  const [staked, rate, earned, stkBal, finish] = await Promise.all([
    staking.totalSupply(), staking.rewardRate(), staking.earned(BRIDGE_USER),
    staking.balanceOf(BRIDGE_USER), staking.periodFinish(),
  ]);
  out.farm = {
    staked: f2(staked),
    earned: f2(earned),
    perDay: f2(rate * 86400n),
    roundEnds: new Date(Number(finish) * 1000).toISOString(),
  };

  const pairAbi = [
    "function getReserves() view returns (uint256,uint256,uint32)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
  ];
  const wpair = new ethers.Contract(WPAIR, pairAbi, pdoge);
  const spair = new ethers.Contract(SBTC_PAIR, pairAbi, pdoge);
  const [wR, wT, wLp] = await Promise.all([wpair.getReserves(), wpair.totalSupply(), wpair.balanceOf(PHANTOM)]);
  const [sR, sT, sLp] = await Promise.all([spair.getReserves(), spair.totalSupply(), spair.balanceOf(PHANTOM)]);
  out.pools = [
    { name: "wPETH / PDOGE", address: WPAIR, token: f2(wR[0]) + " wPETH", native: f2(wR[1]) + " PDOGE",
      price: "1 wPETH = " + (Number(ethers.formatEther(wR[1])) / Number(ethers.formatUnits(wR[0], 18))).toFixed(2) + " PDOGE",
      lpAtPhantom: f2(wLp) },
    { name: "sBTC / PDOGE", address: SBTC_PAIR, token: f2(sR[0]) + " sBTC", native: f2(sR[1]) + " PDOGE",
      price: "1 sBTC = " + Math.round(Number(ethers.formatEther(sR[1])) / Number(ethers.formatUnits(sR[0], 18))).toLocaleString() + " PDOGE",
      lpAtPhantom: f2(sLp) },
  ];

  const sbtc = new ethers.Contract(SBTC, ["function balanceOf(address) view returns (uint256)"], pdoge);
  const wpe = new ethers.Contract(WPETH_PDOGE, ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"], pdoge);
  const [treasury, wSupply, uPdoge, opPdoge, wBal] = await Promise.all([
    sbtc.balanceOf(OPERATOR), wpe.totalSupply(),
    pdoge.getBalance(BRIDGE_USER), pdoge.getBalance(OPERATOR), wpe.balanceOf(BRIDGE_USER),
  ]);
  out.positions = {
    wPethStaked: f2(stkBal),
    wPethUnstaked: f2(wBal),
    pdogeEarned: f2(earned),
    sbtcTreasury: f2(treasury),
    bridgePdoge: f6(uPdoge),
  };
  out.bridge = { wPethSupply: f2(wSupply) };

  // --- service statuses (per-service so one missing unit can't mask the rest) ---
  out.services = {
    node: svcStatus("pdoge-node"),
    relayer: svcStatus("pdoge-relayer"),
    proxy: svcStatus("pdoge-rpc-proxy"),
  };

  // --- mainnet ---
  const vault = new ethers.Contract(VAULT, ["function locked(address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"], l1);
  const peth = new ethers.Contract(PETH, ["function balanceOf(address) view returns (uint256)"], l1);
  const [lockedUser, lockedSavings, vaultBal, phantomPeth] = await Promise.all([
    vault.locked(BRIDGE_USER), vault.locked(SAVINGS), peth.balanceOf(VAULT), peth.balanceOf(PHANTOM),
  ]);
  const lockedAmt = lockedUser + lockedSavings;
  out.bridge.pethLocked = f2(lockedAmt);
  out.bridge.pethStuck = f2(vaultBal - lockedAmt);
  out.mainnet = { phantomPeth: f2(phantomPeth) };

  const uni = new ethers.Contract(UNI_PAIR, ["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)"], l1);
  const [r0, r1] = await uni.getReserves();
  const t0 = await uni.token0();
  const isP0 = t0.toLowerCase() === PETH.toLowerCase();
  out.mainnet.pool = {
    peth: f2(isP0 ? r0 : r1),
    eth: f6(isP0 ? r1 : r0),
  };

  console.log(JSON.stringify(out));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
