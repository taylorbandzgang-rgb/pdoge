// Live pBitcoin status — reads the deployed contract and prints the numbers
// for the State of the Chain page (MINING.md). Read-only: works against the
// public RPC, no private key needed.
//   node scripts/pbitcoin-status.js               # human-readable + JSON
//   PDOGE_RPC_URL=https://34.148.123.122.nip.io node scripts/pbitcoin-status.js
import dotenv from "dotenv";
dotenv.config();
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";

const RPC_URL = process.env.PDOGE_RPC_URL || "https://34.148.123.122.nip.io";
const TOKEN_ADDRESS = process.env.PBITCOIN_ADDRESS || "0x2D3D8Be994ee04531Bfcef9234Be26E793DF5C37";

async function artifact(name) {
  const raw = await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8");
  return JSON.parse(raw);
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 60) return `~${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `~${(seconds / 60).toFixed(1)} min`;
  return `~${(seconds / 3600).toFixed(1)}h`;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const { abi } = await artifact("pBitcoin");
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, provider);

  const net = await provider.getNetwork();
  if (net.chainId !== 42069n) throw new Error(`Wrong chain! Expected 42069 (PDOGE), got ${net.chainId}`);
  const blockNumber = await provider.getBlockNumber();

  const [name, symbol, decimals, totalSupply, minted, maxSupply, target, difficulty, reward, challenge] =
    await Promise.all([
      token.name(), token.symbol(), token.decimals(), token.totalSupply(),
      token.tokensMinted(), token.maxSupply(), token.getMiningTarget(),
      token.getMiningDifficulty(), token.getMiningReward(), token.getChallengeNumber(),
    ]);
  const era = await token.eraFor(minted);
  const pct = (Number(minted) / Number(maxSupply)) * 100;

  // Successful mints = number of Mint events ever emitted. Falls back to
  // minted / current-reward when the RPC won't serve the log query (era 0
  // only, where every mint paid the same reward).
  let mints = null;
  try {
    const events = await token.queryFilter(token.filters.Mint, 0, "latest");
    mints = events.length;
  } catch {
    mints = reward > 0n ? Number(minted / reward) : null;
  }

  // Estimated time to the next mint: expected hashes = difficulty. Nobody
  // knows the network hashrate, so show it at three reference speeds. The
  // contract retargets toward ~10 minutes between mints as miners join.
  const diffNum = Number(difficulty);
  const estimates = {
    "at 18k H/s (reference JS miner)": fmtTime(diffNum / 18_000),
    "at 1 MH/s": fmtTime(diffNum / 1_000_000),
    "at 10 MH/s": fmtTime(diffNum / 10_000_000),
  };

  const out = {
    asOf: new Date().toISOString(),
    blockNumber,
    chainId: 42069,
    contract: TOKEN_ADDRESS,
    name, symbol, decimals: Number(decimals),
    totalSupply: ethers.formatUnits(totalSupply, 8),
    tokensMinted: ethers.formatUnits(minted, 8),
    maxSupply: ethers.formatUnits(maxSupply, 8),
    pctMinted: Number(pct.toFixed(6)),
    successfulMints: mints,
    rewardEra: Number(era),
    currentReward: ethers.formatUnits(reward, 8),
    miningDifficulty: difficulty.toString(),
    miningTarget: target.toString(),
    challengeNumber: challenge,
    estimatedTimeToNextMint: estimates,
  };

  console.log(`pBitcoin (${name} ${symbol}) — chain 42069, block ${blockNumber}, ${out.asOf}`);
  console.log(`Contract: ${TOKEN_ADDRESS}`);
  console.log(`Minted: ${out.tokensMinted} / ${out.maxSupply} (${out.pctMinted}%) — ${mints ?? "?"} successful mints`);
  console.log(`Reward era: ${out.rewardEra} — current reward ${out.currentReward} pBitcoin per mint`);
  console.log(`Difficulty: ${out.miningDifficulty} hashes expected per mint`);
  for (const [k, v] of Object.entries(estimates)) console.log(`  next mint ${k}: ${v}`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
