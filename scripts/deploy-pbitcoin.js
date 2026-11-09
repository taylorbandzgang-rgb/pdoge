// Deploy pBitcoin (mineable token) to the PseudoDogecoin chain.
//   1. Compile:  npx hardhat compile
//   2. Start the node:  npm run node   (local test) — or point PDOGE_RPC_URL
//      at the live PDOGE RPC for the real deploy (run on the GCE VM only).
//   3. Deploy:  node scripts/deploy-pbitcoin.js
//
// Requires .env with OPERATOR_PRIVATE_KEY. NEVER commit .env.
// The deployer gets nothing special: pBitcoin has no owner, no premine,
// supply is zero at deploy and every token must be mined.
import dotenv from "dotenv";
dotenv.config();
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";
import { Sender } from "./tx.js";

const RPC_URL = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546";

async function artifact(name) {
  const raw = await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const key = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!key) throw new Error("Set OPERATOR_PRIVATE_KEY in .env (never commit it, never paste it in chat)");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(key, provider);
  const sender = new Sender(provider, wallet);
  await sender.init();

  const net = await provider.getNetwork();
  if (net.chainId !== 42069n) throw new Error(`Wrong chain! Expected 42069 (PDOGE), got ${net.chainId}`);

  const bal = await provider.getBalance(wallet.address);
  console.log("Deploying pBitcoin with:", wallet.address);
  console.log("PDOGE balance:", ethers.formatEther(bal));
  if (bal === 0n) throw new Error("Operator has no PDOGE — fund it first (node scripts/faucet.js <address>)");

  const { abi, bytecode } = await artifact("pBitcoin");
  const token = await sender.deploy(abi, bytecode);
  const addr = await token.getAddress();
  console.log("pBitcoin deployed to:", addr);
  console.log("name:", await token.name());
  console.log("symbol:", await token.symbol());
  console.log("decimals:", await token.decimals());
  console.log("maxSupply:", ethers.formatUnits(await token.maxSupply(), 8), "pBitcoin");
  console.log("totalSupply at deploy:", ethers.formatUnits(await token.totalSupply(), 8), "pBitcoin (must be 0 — no premine)");
  console.log("initial mining reward:", ethers.formatUnits(await token.getMiningReward(), 8), "pBitcoin");
  console.log("initial mining difficulty:", (await token.getMiningDifficulty()).toString());
  console.log("PBITCOIN_ADDRESS=" + addr);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
