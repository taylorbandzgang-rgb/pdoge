// Deploy PDOGESwapFactory + wPETH/PDOGE pair, seed initial liquidity:
// unstake 2500 wPETH (bridge wallet), pair with 25,000 PDOGE (operator),
// LP tokens minted directly to Domenic's Phantom address.
// Run: node scripts/deploy-liquidity.js
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
const WETH_STAKE = ethers.parseUnits("2500", 18); // half stays farming
const PDOGE_LIQ = ethers.parseEther("25000"); // 10 PDOGE per wPETH

const stakingAbi = ["function withdraw(uint256)", "function earned(address) view returns (uint256)"];
const wPethAbi = ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];

async function sendSeq(wallet, txs) {
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  const hashes = [];
  for (const tx of txs) {
    const t = await wallet.sendTransaction({ ...tx, nonce: nonce++ });
    await t.wait();
    hashes.push(t.hash);
  }
  return hashes;
}

async function main() {
  const op = new ethers.Wallet(env("OPERATOR_PRIVATE_KEY"), provider);
  const user = new ethers.Wallet(env("BRIDGE_USER_PRIVATE_KEY"), provider);
  const BRIDGE_USER = env("BRIDGE_USER_ADDRESS");

  // 1. Factory + pair.
  const fArtifact = JSON.parse(fs.readFileSync("artifacts/contracts/PDOGESwapFactory.sol/PDOGESwapFactory.json", "utf8"));
  const factory = await new ethers.ContractFactory(fArtifact.abi, fArtifact.bytecode, op).deploy(WPETH);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("factory:", factoryAddr);
  const pairAddr = await factory.createPair.staticCall();
  await (await factory.createPair()).wait();
  console.log("pair:", pairAddr);

  // 2. Operator funds bridge wallet with 25,000 PDOGE.
  await provider.send("anvil_setBalance", [op.address, "0x" + ethers.parseEther("1000000").toString(16)]);
  const [h0] = await sendSeq(op, [{ to: BRIDGE_USER, value: PDOGE_LIQ }]);
  console.log("25k PDOGE -> bridge wallet:", h0);

  // 3. Bridge wallet: unstake 2500 wPETH, send to pair, mint LP to Phantom.
  const staking = new ethers.Contract(STAKING, stakingAbi, provider);
  const wPeth = new ethers.Contract(WPETH, wPethAbi, provider);
  const pair = new ethers.Contract(pairAddr, ["function mint(address) payable returns (uint256)"], provider);

  const earnedBefore = await staking.earned(BRIDGE_USER);
  console.log("earned PDOGE before unstake:", ethers.formatUnits(earnedBefore, 18), "(stays claimable)");

  const [h1, h2, h3] = await sendSeq(user, [
    { to: STAKING, data: staking.interface.encodeFunctionData("withdraw", [WETH_STAKE]) },
    { to: WPETH, data: wPeth.interface.encodeFunctionData("transfer", [pairAddr, WETH_STAKE]) },
    { to: pairAddr, data: pair.interface.encodeFunctionData("mint", [PHANTOM]), value: PDOGE_LIQ },
  ]);
  console.log("unstaked 2500 wPETH:", h1);
  console.log("wPETH -> pair:", h2);
  console.log("mint LP -> Phantom:", h3);

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
