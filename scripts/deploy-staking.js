// Deploy WPETHStaking, fund a 30-day PDOGE reward round, stake the bridge
// wallet's 5000 wPETH. Run: node scripts/deploy-staking.js
import { ethers } from "ethers";
import fs from "node:fs";

const PDOGE_RPC = "http://127.0.0.1:8546";
const provider = new ethers.JsonRpcProvider(PDOGE_RPC);

function env(k) {
  const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${k}=(.+)$`, "m"));
  if (!m) throw new Error("missing " + k);
  return m[1].trim();
}

const OPERATOR_KEY = env("OPERATOR_PRIVATE_KEY");
const BRIDGE_USER_KEY = env("BRIDGE_USER_PRIVATE_KEY");
const BRIDGE_USER = env("BRIDGE_USER_ADDRESS");
const WPETH = env("WPETH_ADDRESS");

const REWARD_PDOGE = "30000"; // 30k PDOGE over 30 days = 1k/day for full stake
const STAKE_WPETH = "5000";

const stakingAbi = ["function notifyRewardAmount() payable", "function rewardRate() view returns (uint256)", "function periodFinish() view returns (uint256)", "function totalSupply() view returns (uint256)"];
const wPethAbi = ["function approve(address,uint256) returns (bool)", "function stake(uint256)", "function balanceOf(address) view returns (uint256)"];

async function main() {
  const op = new ethers.Wallet(OPERATOR_KEY, provider);

  // Make sure operator can fund 30k PDOGE (dev chain: top up via anvil_setBalance).
  await provider.send("anvil_setBalance", [op.address, "0x" + ethers.parseEther("1000000").toString(16)]);
  console.log("operator topped up");

  const artifact = JSON.parse(fs.readFileSync("artifacts/contracts/WPETHStaking.sol/WPETHStaking.json", "utf8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, op);
  const staking = await factory.deploy(WPETH);
  await staking.waitForDeployment();
  const addr = await staking.getAddress();
  console.log("WPETHStaking deployed:", addr);

  const fund = await staking.notifyRewardAmount({ value: ethers.parseEther(REWARD_PDOGE) });
  await fund.wait();
  console.log(`funded: ${REWARD_PDOGE} PDOGE / 30 days`);

  // Stake the bridge wallet's wPETH.
  const user = new ethers.Wallet(BRIDGE_USER_KEY, provider);
  const wPeth = new ethers.Contract(WPETH, ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], user);
  const bal = await wPeth.balanceOf(BRIDGE_USER);
  console.log("bridge wallet wPETH:", ethers.formatUnits(bal, 18));
  const stakingAsUser = new ethers.Contract(addr, ["function stake(uint256)"], user);
  const t1 = await wPeth.approve(addr, bal);
  await t1.wait();
  const t2 = await stakingAsUser.stake(bal);
  await t2.wait();
  console.log(`staked ${ethers.formatUnits(bal, 18)} wPETH from bridge wallet`);

  const rate = await new ethers.Contract(addr, stakingAbi, provider).rewardRate();
  console.log("rewardRate (PDOGE/sec):", ethers.formatUnits(rate, 18));
  console.log("STAKING_ADDRESS=" + addr);
}

main().catch((e) => { console.error(e); process.exit(1); });
