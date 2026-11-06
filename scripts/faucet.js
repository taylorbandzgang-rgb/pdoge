// Send native PDOGE from the operator to an address (faucet).
// Usage: node scripts/faucet.js <address> [amount in PDOGE, default 100]
import dotenv from "dotenv";
dotenv.config();
import { ethers } from "ethers";

const RPC_URL = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546";

async function main() {
  const to = process.argv[2];
  const amount = process.argv[3] || "100";
  if (!to || !ethers.isAddress(to)) throw new Error("Usage: node scripts/faucet.js <address> [amount]");
  const key = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!key) throw new Error("Set OPERATOR_PRIVATE_KEY in .env");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(key, provider);
  const tx = await wallet.sendTransaction({ to, value: ethers.parseEther(amount) });
  console.log(`Sent ${amount} PDOGE to ${to}: ${tx.hash}`);
  await tx.wait();
  console.log("Confirmed.");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
