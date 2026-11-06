// Recover from the address(0) mint bug: deploy fresh factory+pair,
// skim the stranded 2500 wPETH out of the old pair, seed the new pool,
// mint LP directly to Domenic's Phantom address.
// Run: node scripts/recover-liquidity.js
import { ethers } from "ethers";
import fs from "node:fs";

const PDOGE_RPC = "http://127.0.0.1:8546";
const provider = new ethers.JsonRpcProvider(PDOGE_RPC);
function env(k) {
  const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${k}=(.+)$`, "m"));
  if (!m) throw new Error("missing " + k);
  return m[1].trim();
}

const PHANTOM = "0x1bbae640072033ee04414d1e980dca180b6aef75";
const WPETH = env("WPETH_ADDRESS");
const OLD_PAIR = "0x835a51C268a882e6875EF6bAB25c13a47c353De6";
const WSTAKE = ethers.parseUnits("2500", 18);
const PLIQ = ethers.parseEther("25000");
const BRIDGE_USER = env("BRIDGE_USER_ADDRESS");

async function sendRetry(wallet, tx, maxTries = 8) {
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
  const op = new ethers.Wallet(env("OPERATOR_PRIVATE_KEY"), provider);
  const user = new ethers.Wallet(env("BRIDGE_USER_PRIVATE_KEY"), provider);

  // 1. Fresh factory + pair (fixed contract).
  const fArtifact = JSON.parse(fs.readFileSync("artifacts/contracts/PDOGESwapFactory.sol/PDOGESwapFactory.json", "utf8"));
  const factoryIface = new ethers.ContractFactory(fArtifact.abi, fArtifact.bytecode, op);
  const deployTx = await factoryIface.getDeployTransaction(WPETH);
  const dt = await sendRetry(op, { data: deployTx.data });
  const factoryAddr = ethers.getCreateAddress({ from: op.address, nonce: dt.nonce });
  console.log("factory:", factoryAddr, dt.hash);
  const factory = new ethers.Contract(factoryAddr, fArtifact.abi, provider);
  const pairAddr = await factory.createPair.staticCall();
  const ct = await sendRetry(op, { to: factoryAddr, data: factory.interface.encodeFunctionData("createPair") });
  console.log("pair:", pairAddr, ct.hash);

  // 2. Skim stranded 2500 wPETH from the old (broken) pair back to bridge wallet.
  const oldPair = new ethers.Contract(OLD_PAIR, ["function skim(address)"], provider);
  const t0 = await sendRetry(user, { to: OLD_PAIR, data: oldPair.interface.encodeFunctionData("skim", [BRIDGE_USER]) });
  console.log("recovered wPETH from old pair:", t0.hash);

  // 3. Seed the new pool: wPETH in, then mint LP -> Phantom with 25k PDOGE.
  const wPeth = new ethers.Contract(WPETH, ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], provider);
  const pair = new ethers.Contract(pairAddr, ["function mint(address) payable returns (uint256)"], provider);
  const bal = await wPeth.balanceOf(BRIDGE_USER);
  console.log("bridge wallet wPETH:", ethers.formatUnits(bal, 18));

  const t1 = await sendRetry(user, { to: WPETH, data: wPeth.interface.encodeFunctionData("transfer", [pairAddr, WSTAKE]) });
  console.log("wPETH -> pair:", t1.hash);
  const t2 = await sendRetry(user, { to: pairAddr, data: pair.interface.encodeFunctionData("mint", [PHANTOM]), value: PLIQ });
  console.log("mint LP -> Phantom:", t2.hash);

  // 4. Verify.
  const r = new ethers.Contract(pairAddr, ["function getReserves() view returns (uint256,uint256,uint32)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"], provider);
  const [rW, rP] = await r.getReserves();
  console.log("reserves:", ethers.formatUnits(rW, 18), "wPETH /", ethers.formatEther(rP), "PDOGE");
  console.log("price: 1 wPETH =", Number(ethers.formatEther(rP)) / Number(ethers.formatUnits(rW, 18)), "PDOGE");
  console.log("LP totalSupply:", ethers.formatUnits(await r.totalSupply(), 18));
  console.log("LP @ Phantom:", ethers.formatUnits(await r.balanceOf(PHANTOM), 18));
  console.log("FACTORY_ADDRESS=" + factoryAddr);
  console.log("PAIR_ADDRESS=" + pairAddr);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
