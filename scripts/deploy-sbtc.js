// Deploy SyntheticBTC, seed sBTC/PDOGE pool via factory v2.
// 21 sBTC minted; 10 sBTC + 100,000 PDOGE seeded (1 sBTC = 10,000 PDOGE);
// 11 sBTC stays in operator treasury. LP -> Domenic's Phantom.
// Run: node scripts/deploy-sbtc.js
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
const SBTC_SEED = ethers.parseUnits("10", 18);
const PDOGE_SEED = ethers.parseEther("100000"); // 1 sBTC = 10,000 PDOGE

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

  // 1. sBTC token.
  const sbtcArt = JSON.parse(fs.readFileSync("artifacts/contracts/SyntheticBTC.sol/SyntheticBTC.json", "utf8"));
  const sbtcDeploy = await new ethers.ContractFactory(sbtcArt.abi, sbtcArt.bytecode, op).getDeployTransaction();
  const dt0 = await sendRetry(op, { data: sbtcDeploy.data });
  const sbtcAddr = ethers.getCreateAddress({ from: op.address, nonce: dt0.nonce });
  console.log("sBTC:", sbtcAddr, dt0.hash);
  const sbtc = new ethers.Contract(sbtcAddr, sbtcArt.abi, provider);

  const tMint = await sendRetry(op, { to: sbtcAddr, data: sbtc.interface.encodeFunctionData("mint", [op.address, ethers.parseUnits("21", 18)]) });
  console.log("minted 21 sBTC to operator:", tMint.hash);

  // 2. Factory v2 (generic createNativePair) + sBTC/PDOGE pair.
  const fArt = JSON.parse(fs.readFileSync("artifacts/contracts/PDOGESwapFactory.sol/PDOGESwapFactory.json", "utf8"));
  const fDeploy = await new ethers.ContractFactory(fArt.abi, fArt.bytecode, op).getDeployTransaction(WPETH);
  const dt1 = await sendRetry(op, { data: fDeploy.data });
  const factoryAddr = ethers.getCreateAddress({ from: op.address, nonce: dt1.nonce });
  console.log("factory v2:", factoryAddr, dt1.hash);
  const factory = new ethers.Contract(factoryAddr, fArt.abi, provider);
  const pairAddr = await factory.createNativePair.staticCall(sbtcAddr);
  const tPair = await sendRetry(op, { to: factoryAddr, data: factory.interface.encodeFunctionData("createNativePair", [sbtcAddr]) });
  console.log("sBTC/PDOGE pair:", pairAddr, tPair.hash);

  // 3. Seed: 10 sBTC -> pair, then mint LP -> Phantom with 100k PDOGE.
  await provider.send("anvil_setBalance", [op.address, "0x" + ethers.parseEther("1000000").toString(16)]);
  const pair = new ethers.Contract(pairAddr, ["function mint(address) payable returns (uint256)"], provider);
  const t1 = await sendRetry(op, { to: sbtcAddr, data: sbtc.interface.encodeFunctionData("transfer", [pairAddr, SBTC_SEED]) });
  console.log("10 sBTC -> pair:", t1.hash);
  const t2 = await sendRetry(op, { to: pairAddr, data: pair.interface.encodeFunctionData("mint", [PHANTOM]), value: PDOGE_SEED });
  console.log("mint LP -> Phantom:", t2.hash);

  // 4. Verify.
  const r = new ethers.Contract(pairAddr, ["function getReserves() view returns (uint256,uint256,uint32)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"], provider);
  const [rT, rP] = await r.getReserves();
  console.log("reserves:", ethers.formatUnits(rT, 18), "sBTC /", ethers.formatEther(rP), "PDOGE");
  console.log("price: 1 sBTC =", Number(ethers.formatEther(rP)) / Number(ethers.formatUnits(rT, 18)), "PDOGE");
  console.log("LP totalSupply:", ethers.formatUnits(await r.totalSupply(), 18));
  console.log("LP (sBTC pool) @ Phantom:", ethers.formatUnits(await r.balanceOf(PHANTOM), 18));
  console.log("operator sBTC treasury:", ethers.formatUnits(await sbtc.balanceOf(op.address), 18));
  console.log("SBTC_ADDRESS=" + sbtcAddr);
  console.log("FACTORY_V2_ADDRESS=" + factoryAddr);
  console.log("SBTC_PAIR_ADDRESS=" + pairAddr);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
