// Resume liquidity seeding (factory+pair already deployed).
// Run: node scripts/finish-liquidity.js
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
const STAKING = env("STAKING_ADDRESS");
const FACTORY = "0x2016Ecc00293a6929d785DCAaC9a800852C7959b";
const PAIR = "0x835a51C268a882e6875EF6bAB25c13a47c353De6";
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

  await provider.send("anvil_setBalance", [op.address, "0x" + ethers.parseEther("1000000").toString(16)]);
  const t0 = await sendRetry(op, { to: BRIDGE_USER, value: PLIQ });
  console.log("25k PDOGE -> bridge wallet:", t0.hash);

  const staking = new ethers.Contract(STAKING, ["function withdraw(uint256)", "function earned(address) view returns (uint256)"], provider);
  const wPeth = new ethers.Contract(WPETH, ["function transfer(address,uint256) returns (bool)"], provider);
  const pair = new ethers.Contract(PAIR, ["function mint(address) payable returns (uint256)"], provider);

  console.log("earned PDOGE (stays claimable):", ethers.formatUnits(await staking.earned(BRIDGE_USER), 18));

  const t1 = await sendRetry(user, { to: STAKING, data: staking.interface.encodeFunctionData("withdraw", [WSTAKE]) });
  console.log("unstaked 2500 wPETH:", t1.hash);
  const t2 = await sendRetry(user, { to: WPETH, data: wPeth.interface.encodeFunctionData("transfer", [PAIR, WSTAKE]) });
  console.log("wPETH -> pair:", t2.hash);
  const t3 = await sendRetry(user, { to: PAIR, data: pair.interface.encodeFunctionData("mint", [PHANTOM]), value: PLIQ });
  console.log("mint LP -> Phantom:", t3.hash);

  const r = new ethers.Contract(PAIR, ["function getReserves() view returns (uint256,uint256,uint32)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"], provider);
  const [rW, rP] = await r.getReserves();
  console.log("reserves:", ethers.formatUnits(rW, 18), "wPETH /", ethers.formatEther(rP), "PDOGE");
  console.log("price: 1 wPETH =", Number(ethers.formatEther(rP)) / Number(ethers.formatUnits(rW, 18)), "PDOGE");
  console.log("LP totalSupply:", ethers.formatUnits(await r.totalSupply(), 18));
  console.log("LP @ Phantom:", ethers.formatUnits(await r.balanceOf(PHANTOM), 18));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
