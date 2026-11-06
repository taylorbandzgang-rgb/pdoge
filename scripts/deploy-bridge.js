// Deploy the bidirectional bridge contracts (adapted to Hardhat 3 + ethers v6 + ESM).
//
//   PDOGE side:  node scripts/deploy-bridge.js --side pdoge
//                  -> WrappedPETH + PDOGEBridge, wPETH ownership -> bridge
//   L1 side:     node scripts/deploy-bridge.js --side l1
//                  -> PETHVault pointing at the real PETH token
//
// Env: PDOGE_RPC_URL, L1_RPC_URL, OPERATOR_PRIVATE_KEY, PETH_TOKEN (L1 only).
// NEVER commit .env.
import dotenv from "dotenv";
dotenv.config();
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";
import { Sender } from "./tx.js";

const REAL_PETH = "0x34fDfEf7F661e95B10F821173763cd4C0d1974ca";

const side = process.argv.includes("--side") ? process.argv[process.argv.indexOf("--side") + 1] : "";
if (!["pdoge", "l1"].includes(side)) {
  console.error("Usage: node scripts/deploy-bridge.js --side pdoge|l1");
  process.exit(1);
}

async function artifact(name) {
  const raw = await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const url = side === "pdoge"
    ? process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546"
    : process.env.L1_RPC_URL || "";
  if (!url) throw new Error("Set L1_RPC_URL in .env for --side l1");
  const key = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!key) throw new Error("Set OPERATOR_PRIVATE_KEY in .env");

  const provider = new ethers.JsonRpcProvider(url);
  const wallet = new ethers.Wallet(key, provider);
  const sender = new Sender(provider, wallet);
  await sender.init();

  const net = await provider.getNetwork();
  console.log(`Deploying (${side}) with ${wallet.address} on chain ${net.chainId}`);

  if (side === "pdoge") {
    if (net.chainId !== 42069n) throw new Error(`Wrong chain! Expected 42069, got ${net.chainId}`);
    const { abi: wAbi, bytecode: wBin } = await artifact("WrappedPETH");
    const wPETH = await sender.deploy(wAbi, wBin);
    const wPETHAddr = await wPETH.getAddress();
    console.log("WrappedPETH:", wPETHAddr);

    const { abi: bAbi, bytecode: bBin } = await artifact("PDOGEBridge");
    const bridge = await sender.deploy(bAbi, bBin, wPETHAddr);
    const bridgeAddr = await bridge.getAddress();
    console.log("PDOGEBridge:", bridgeAddr);

    const wPETHasOwner = new ethers.Contract(wPETHAddr, wAbi, wallet);
    const tx = await wPETHasOwner.transferOwnership(bridgeAddr, { nonce: sender.nonce++ });
    await tx.wait();
    console.log("wPETH ownership -> PDOGEBridge. Done.");
    console.log(`\nSave to .env: WPETH_ADDRESS=${wPETHAddr} BRIDGE_ADDRESS=${bridgeAddr}`);
  } else {
    const pethToken = process.env.PETH_TOKEN || REAL_PETH;
    if (!ethers.isAddress(pethToken)) throw new Error("Bad PETH_TOKEN address");
    const { abi: vAbi, bytecode: vBin } = await artifact("PETHVault");
    const vault = await sender.deploy(vAbi, vBin, pethToken);
    const vaultAddr = await vault.getAddress();
    console.log("PETHVault:", vaultAddr, `(peth=${pethToken})`);
    console.log(`\nSave to .env: VAULT_ADDRESS=${vaultAddr}`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
