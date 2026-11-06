// Resume staking setup: fund rewards + stake (run after deploy-staking.js
// deployed the contract). Uses explicit nonce tracking (anvil serves receipts
// before nonce state catches up).
import { ethers } from "ethers";
import fs from "node:fs";

const PDOGE_RPC = "http://127.0.0.1:8546";
const provider = new ethers.JsonRpcProvider(PDOGE_RPC);
function env(k) {
  const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${k}=(.+)$`, "m"));
  if (!m) throw new Error("missing " + k);
  return m[1].trim();
}

const STAKING = "0x1006C1E5cf079fADf2f22444c72af53267f07963";
const stakingAbi = JSON.parse(fs.readFileSync("artifacts/contracts/WPETHStaking.sol/WPETHStaking.json", "utf8")).abi;

async function sendWithNonce(wallet, tx, nonce) {
  const t = await wallet.sendTransaction({ ...tx, nonce });
  await t.wait();
  return t;
}

async function main() {
  const op = new ethers.Wallet(env("OPERATOR_PRIVATE_KEY"), provider);
  const staking = new ethers.Contract(STAKING, stakingAbi, provider);

  let nonce = await provider.getTransactionCount(op.address, "pending");
  const fundTx = await staking.notifyRewardAmount.populateTransaction({ value: ethers.parseEther("30000") });
  const t1 = await sendWithNonce(op, { to: STAKING, data: fundTx.data, value: fundTx.value }, nonce++);
  console.log("funded 30k PDOGE:", t1.hash);

  const user = new ethers.Wallet(env("BRIDGE_USER_PRIVATE_KEY"), provider);
  const wPeth = new ethers.Contract(env("WPETH_ADDRESS"), ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], provider);
  const bal = await wPeth.balanceOf(env("BRIDGE_USER_ADDRESS"));
  console.log("bridge wallet wPETH:", ethers.formatUnits(bal, 18));

  let unonce = await provider.getTransactionCount(user.address, "pending");
  const approveTx = await wPeth.approve.populateTransaction(STAKING, bal);
  const t2 = await sendWithNonce(user, { to: env("WPETH_ADDRESS"), data: approveTx.data }, unonce++);
  await t2.wait();
  const stakeTx = await new ethers.Contract(STAKING, ["function stake(uint256)"], provider).stake.populateTransaction(bal);
  const t3 = await sendWithNonce(user, { to: STAKING, data: stakeTx.data }, unonce++);
  console.log(`staked ${ethers.formatUnits(bal, 18)} wPETH:`, t3.hash);

  const s = new ethers.Contract(STAKING, ["function totalSupply() view returns (uint256)", "function rewardRate() view returns (uint256)", "function earned(address) view returns (uint256)"], provider);
  console.log("totalStaked:", ethers.formatUnits(await s.totalSupply(), 18));
  console.log("rewardRate PDOGE/sec:", ethers.formatUnits(await s.rewardRate(), 18));
  console.log("STAKING_ADDRESS=" + STAKING);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
