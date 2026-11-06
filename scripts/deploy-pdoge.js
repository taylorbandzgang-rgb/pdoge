// Deploy WrappedPETH + DogeBridge to the PseudoDogecoin chain.
//   1. Start the node:  npm run node   (or ./scripts/run-node.sh)
//   2. Fund OPERATOR address with PDOGE: node scripts/faucet.js <operator-address>
//      (on a fresh local node, use one of the printed test keys as OPERATOR_PRIVATE_KEY)
//   3. Deploy: npm run deploy
//
// Requires .env with OPERATOR_PRIVATE_KEY. NEVER commit .env.
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
  console.log("Deploying to PseudoDogecoin with:", wallet.address);
  console.log("PDOGE balance:", ethers.formatEther(bal));
  if (bal === 0n) throw new Error("Operator has no PDOGE — fund it first (node scripts/faucet.js <address>)");

  const { abi: wAbi, bytecode: wBin } = await artifact("WrappedPETH");
  const wPETH = await sender.deploy(wAbi, wBin);
  const wPETHAddr = await wPETH.getAddress();
  console.log("WrappedPETH deployed to:", wPETHAddr);

  const { abi: bAbi, bytecode: bBin } = await artifact("DogeBridge");
  const bridge = await sender.deploy(bAbi, bBin, wPETHAddr);
  const bridgeAddr = await bridge.getAddress();
  console.log("DogeBridge deployed to:", bridgeAddr);

  // Hand wPETH mint control to the bridge.
  const wPETHasOwner = new ethers.Contract(wPETHAddr, wAbi, wallet);
  const tx = await wPETHasOwner.transferOwnership(bridgeAddr, { nonce: sender.nonce++ });
  await tx.wait();
  console.log("wPETH ownership transferred to DogeBridge. Done.");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
