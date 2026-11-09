// Sweep mined pBitcoin from the operator wallet to the savings wallet.
// Runs on the GCE VM (daily systemd timer). Moves the FULL pBitcoin balance;
// exits cleanly when there is nothing to sweep.
//   node scripts/sweep-pbitcoin.js
//
// Env:
//   PDOGE_RPC_URL        RPC endpoint (default http://127.0.0.1:8545)
//   PBITCOIN_ADDRESS     pBitcoin contract (default the live address)
//   SAVINGS_ADDRESS      destination (default the savings wallet)
//   OPERATOR_PRIVATE_KEY operator key (or MINER_PRIVATE_KEY as fallback).
//                       The signer MUST derive to the operator address or
//                       the script refuses to run.
//   Never put a real key in this file or commit one in .env.
import dotenv from "dotenv";
dotenv.config();
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";

const RPC_URL = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8545";
const TOKEN_ADDRESS = process.env.PBITCOIN_ADDRESS || "0x2D3D8Be994ee04531Bfcef9234Be26E793DF5C37";
const SAVINGS_ADDRESS = process.env.SAVINGS_ADDRESS || "0xd42F201ed7502D7AF699E2F523590567899a1Ae9";
const OPERATOR_ADDRESS = "0xD843A526EC1DDc009510c2cd3403f06b2094C356";
const KEY = process.env.OPERATOR_PRIVATE_KEY || process.env.MINER_PRIVATE_KEY || "";
if (!KEY) throw new Error("Set OPERATOR_PRIVATE_KEY in env");

async function artifact(name) {
  const raw = await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(KEY, provider);
  if (wallet.address.toLowerCase() !== OPERATOR_ADDRESS.toLowerCase()) {
    throw new Error(`Refusing to run: signer ${wallet.address} is not the operator ${OPERATOR_ADDRESS}`);
  }
  const net = await provider.getNetwork();
  if (net.chainId !== 42069n) throw new Error(`Wrong chain! Expected 42069 (PDOGE), got ${net.chainId}`);

  const { abi } = await artifact("pBitcoin");
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);
  const balance = await token.balanceOf(wallet.address);
  console.log(`Operator pBitcoin balance: ${ethers.formatUnits(balance, 8)}`);
  if (balance === 0n) {
    console.log("Nothing to sweep.");
    return;
  }
  const tx = await token.transfer(SAVINGS_ADDRESS, balance);
  console.log("sweep tx:", tx.hash);
  const rc = await tx.wait();
  console.log(`Swept ${ethers.formatUnits(balance, 8)} pBitcoin to savings ${SAVINGS_ADDRESS} in block ${rc.blockNumber}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
