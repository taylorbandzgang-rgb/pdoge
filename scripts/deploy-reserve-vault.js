// Deploy SBTCRedeem (PDOGE) + PETHReserveVault (mainnet).
// Run: node scripts/deploy-reserve-vault.js
import { ethers } from "ethers";
import fs from "node:fs";

const PDOGE_RPC = "http://127.0.0.1:8546";
const L1_RPC = "https://ethereum-rpc.publicnode.com";
function env(k) {
  const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${k}=(.+)$`, "m"));
  if (!m) throw new Error("missing " + k);
  return m[1].trim();
}

const PETH_MAINNET = "0x34fDfEf7F661e95B10F821173763cd4C0d1974ca";
const SBTC = env("SBTC_ADDRESS");
const OPERATOR = env("OPERATOR_ADDRESS");

async function sendRetry(wallet, provider, tx, maxTries = 8) {
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  for (let i = 0; i < maxTries; i++) {
    try {
      const t = await wallet.sendTransaction({ ...tx, nonce });
      await t.wait();
      return t;
    } catch (e) {
      if (e.code === "NONCE_EXPIRED" || (e.message || "").includes("nonce")) {
        nonce = await provider.getTransactionCount(wallet.address, "pending");
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      throw e;
    }
  }
  throw new Error("nonce retries exhausted");
}

async function main() {
  const pdoge = new ethers.JsonRpcProvider(PDOGE_RPC);
  const l1 = new ethers.JsonRpcProvider(L1_RPC);
  const opP = new ethers.Wallet(env("OPERATOR_PRIVATE_KEY"), pdoge);
  const opL1 = new ethers.Wallet(env("OPERATOR_PRIVATE_KEY"), l1);

  // 1. SBTCRedeem on PDOGE.
  const rArt = JSON.parse(fs.readFileSync("artifacts/contracts/SBTCRedeem.sol/SBTCRedeem.json", "utf8"));
  const rDeploy = await new ethers.ContractFactory(rArt.abi, rArt.bytecode, opP).getDeployTransaction(SBTC, OPERATOR);
  const rt = await sendRetry(opP, pdoge, { data: rDeploy.data });
  const redeemAddr = ethers.getCreateAddress({ from: opP.address, nonce: rt.nonce });
  console.log("SBTCRedeem (PDOGE):", redeemAddr, rt.hash);

  // 2. PETHReserveVault on mainnet.
  const vArt = JSON.parse(fs.readFileSync("artifacts/contracts/PETHReserveVault.sol/PETHReserveVault.json", "utf8"));
  const vDeploy = await new ethers.ContractFactory(vArt.abi, vArt.bytecode, opL1).getDeployTransaction(PETH_MAINNET);
  const vt = await sendRetry(opL1, l1, { data: vDeploy.data });
  const vaultAddr = ethers.getCreateAddress({ from: opL1.address, nonce: vt.nonce });
  console.log("PETHReserveVault (mainnet):", vaultAddr, vt.hash);

  // 3. Verify the vault points at real PETH and is empty (unfunded until Domenic sends PETH).
  const vault = new ethers.Contract(vaultAddr, vArt.abi, l1);
  console.log("vault.peth():", await vault.peth());
  console.log("vault reserve:", ethers.formatUnits(await vault.getReserveBalance(), 18), "PETH");

  console.log("SBTC_REDEEM_ADDRESS=" + redeemAddr);
  console.log("RESERVE_VAULT_ADDRESS=" + vaultAddr);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
