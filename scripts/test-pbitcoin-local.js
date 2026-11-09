// Local test for pBitcoin — run against a local Hardhat node only.
//   1. npx hardhat node --port 8546 --chain-id 42069   (separate terminal)
//   2. MINER_PRIVATE_KEY=<throwaway test key> node scripts/test-pbitcoin-local.js
// Uses only the local node's throwaway test account. Never run against live
// chain / mainnet with this script.
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";

const RPC_URL = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546";
const KEY = process.env.MINER_PRIVATE_KEY || "";
if (!KEY) throw new Error("Set MINER_PRIVATE_KEY to a local test-node throwaway key");

const T = (n) => ethers.parseUnits(n.toString(), 8); // tokens -> base units
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!cond) failures += 1;
}
function digestFor(challenge, miner, nonce) {
  return ethers.solidityPackedKeccak256(["bytes32", "address", "uint256"], [challenge, miner, nonce]);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(KEY, provider);
  const net = await provider.getNetwork();
  check("chain is 42069", net.chainId === 42069n, `got ${net.chainId}`);

  const { abi, bytecode } = JSON.parse(
    await readFile("./artifacts/contracts/pBitcoin.sol/pBitcoin.json", "utf8")
  );
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const token = await factory.deploy();
  const addr = await token.getAddress();
  await token.waitForDeployment();
  console.log("pBitcoin deployed (LOCAL TEST ONLY):", addr);

  // --- Static spec ---
  check("name is pBitcoin", (await token.name()) === "pBitcoin");
  check("symbol is ₿ (U+20BF)", (await token.symbol()) === "₿", `got ${await token.symbol()}`);
  check("decimals is 8", (await token.decimals()) === 8n);
  check("maxSupply is 21,000,000 tokens", (await token.maxSupply()) === T(21_000_000));
  check("totalSupply is 0 at deploy (no premine)", (await token.totalSupply()) === 0n);
  check("tokensMinted is 0 at deploy", (await token.tokensMinted()) === 0n);
  check("deployer balance is 0 (no premine)", (await token.balanceOf(wallet.address)) === 0n);
  check("initial reward is 50 tokens", (await token.getMiningReward()) === T(50));
  // Difficulty = (2^256 - 1) / 2^240 = 65535, i.e. ~2^16 hashes expected per mint.
  check("initial difficulty is 65535 (~2^16)", (await token.getMiningDifficulty()) === 65535n);
  check("initial target is 2^240", (await token.getMiningTarget()) === 2n ** 240n);

  // --- Era / reward math (pure helpers — this is how the cap is tested
  //  without mining out 21M tokens, which would take ~7M mints) ---
  check("rewardFor(0) = 50", (await token.rewardFor(0n)) === T(50));
  check("rewardFor(10,499,999 tokens) = 50", (await token.rewardFor(T(10_499_999))) === T(50));
  check("rewardFor(10,500,000 tokens) = 25 (era 1)", (await token.rewardFor(T(10_500_000))) === T(25));
  check("rewardFor(15,750,000 tokens) = 12.5 (era 2)", (await token.rewardFor(T(15_750_000))) === T("12.5"));
  check("rewardFor(18,375,000 tokens) = 6.25 (era 3)", (await token.rewardFor(T(18_375_000))) === T("6.25"));
  check("eraFor(0) = 0", (await token.eraFor(0n)) === 0n);
  check("eraFor(10,500,000 tokens) = 1", (await token.eraFor(T(10_500_000))) === 1n);
  check("rewardFor(maxSupply) = 0 (mining over at cap)", (await token.rewardFor(T(21_000_000))) === 0n);
  check("rewardFor(maxSupply - 1 base unit) = 0", (await token.rewardFor(T(21_000_000) - 1n)) === 0n);

  // --- Real mined mint ---
  const challenge0 = await token.getChallengeNumber();
  const target0 = await token.getMiningTarget();
  let nonce = 0n;
  let digest;
  let tries = 0;
  for (;;) {
    digest = digestFor(challenge0, wallet.address, nonce);
    if (BigInt(digest) < target0) break;
    nonce += 1n;
    tries += 1;
  }
  console.log(`Found valid nonce ${nonce} after ${tries} tries (target 2^240)`);
  const tx = await token.mint(nonce, digest);
  const rc = await tx.wait();
  console.log("mint tx:", tx.hash, "block:", rc.blockNumber);

  check("miner balance is exactly 50 tokens", (await token.balanceOf(wallet.address)) === T(50));
  check("tokensMinted is 50 tokens", (await token.tokensMinted()) === T(50));
  check("totalSupply is 50 tokens", (await token.totalSupply()) === T(50));
  const challenge1 = await token.getChallengeNumber();
  check("challengeNumber changed after mint", challenge1 !== challenge0);
  const target1 = await token.getMiningTarget();
  check(
    "target halved after fast mint (elapsed < 600s, clamped to 2x move)",
    target1 === target0 / 2n,
    `was ${target0}, now ${target1}`
  );
  check("reward still 50 (still era 0)", (await token.getMiningReward()) === T(50));

  // --- Replay must fail ---
  // Use staticCall so the replay is proven to revert inside the contract
  // (digest mismatch — the challenge changed) rather than being rejected
  // at the node level for any other reason.
  let replayReverted = false;
  let replayReason = "";
  try {
    await token.mint.staticCall(nonce, digest);
  } catch (e) {
    replayReverted = true;
    replayReason = (e.shortMessage || e.message || "").split("\n")[0];
    console.log("Replay reverted as expected:", replayReason);
  }
  check(
    "replay of same nonce/digest reverts with digest mismatch",
    replayReverted && replayReason.includes("digest mismatch"),
    replayReason
  );

  // --- Wrong digest must fail ---
  let wrongReverted = false;
  try {
    const tx3 = await token.mint(nonce + 1n, digest); // digest does not match this nonce
    await tx3.wait();
  } catch (e) {
    wrongReverted = true;
    console.log("Wrong-digest mint reverted as expected:", (e.shortMessage || e.message || "").split("\n")[0]);
  }
  check("mint with mismatched digest reverts", wrongReverted);

  // --- Digest above target must fail (find a nonce whose digest is >= target) ---
  const challengeNow = await token.getChallengeNumber();
  let badNonce = 0n;
  let badDigest;
  for (;;) {
    badDigest = digestFor(challengeNow, wallet.address, badNonce);
    if (BigInt(badDigest) >= (await token.getMiningTarget())) break;
    badNonce += 1n;
  }
  let aboveReverted = false;
  try {
    const tx4 = await token.mint(badNonce, badDigest);
    await tx4.wait();
  } catch (e) {
    aboveReverted = true;
    console.log("Above-target mint reverted as expected:", (e.shortMessage || e.message || "").split("\n")[0]);
  }
  check("mint with digest above target reverts", aboveReverted);

  // --- Second real mint (proves the new challenge is mineable) ---
  const challenge2 = await token.getChallengeNumber();
  const target2 = await token.getMiningTarget();
  let nonce2 = 0n;
  let digest2;
  for (;;) {
    digest2 = digestFor(challenge2, wallet.address, nonce2);
    if (BigInt(digest2) < target2) break;
    nonce2 += 1n;
  }
  await (await token.mint(nonce2, digest2)).wait();
  check("second mint pays another 50 (balance 100)", (await token.balanceOf(wallet.address)) === T(100));
  check("tokensMinted is 100 tokens", (await token.tokensMinted()) === T(100));

  console.log(failures === 0 ? "\nALL LOCAL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
