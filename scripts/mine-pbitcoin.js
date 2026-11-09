// Mine pBitcoin (EIP-918 style) on the PDOGE chain.
//   node scripts/mine-pbitcoin.js --once            # find one solution, submit it, exit
//   node scripts/mine-pbitcoin.js                   # keep mining until stopped
//
// Env:
//   PBITCOIN_ADDRESS    pBitcoin contract address (or --address <addr>)
//   PDOGE_RPC_URL       RPC endpoint (default http://127.0.0.1:8546)
//   MINER_PRIVATE_KEY   miner's key (or OPERATOR_PRIVATE_KEY as fallback).
//                       The miner needs PDOGE for gas. On a local test node,
//                       use one of the node's throwaway test accounts.
//   Never put a real key in this file or commit one in .env.
import dotenv from "dotenv";
dotenv.config();
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";

const args = process.argv.slice(2);
const once = args.includes("--once");
const addrFlag = args.indexOf("--address");
const rpcFlag = args.indexOf("--rpc");

const RPC_URL = rpcFlag >= 0 ? args[rpcFlag + 1] : process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546";
const TOKEN_ADDRESS = addrFlag >= 0 ? args[addrFlag + 1] : process.env.PBITCOIN_ADDRESS;
const KEY = process.env.MINER_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY || "";
if (!TOKEN_ADDRESS) throw new Error("Set PBITCOIN_ADDRESS (env or --address <addr>)");
if (!KEY) throw new Error("Set MINER_PRIVATE_KEY in env (throwaway test key for local runs)");

async function artifact(name) {
  const raw = await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8");
  return JSON.parse(raw);
}

function digestFor(challenge, miner, nonce) {
  return ethers.solidityPackedKeccak256(
    ["bytes32", "address", "uint256"],
    [challenge, miner, nonce]
  );
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(KEY, provider);
  const { abi } = await artifact("pBitcoin");
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);

  const net = await provider.getNetwork();
  if (net.chainId !== 42069n) throw new Error(`Wrong chain! Expected 42069 (PDOGE), got ${net.chainId}`);
  console.log(`Miner ${wallet.address} on chain ${net.chainId} -> pBitcoin ${TOKEN_ADDRESS}`);

  let mined = 0;
  for (;;) {
    const [challenge, target, reward, minted, difficulty] = await Promise.all([
      token.getChallengeNumber(),
      token.getMiningTarget(),
      token.getMiningReward(),
      token.tokensMinted(),
      token.getMiningDifficulty(),
    ]);
    if (reward === 0n) {
      console.log("Mining over: reward is 0 (cap reached in practice). Stopping.");
      return;
    }
    const targetBig = BigInt(target);
    console.log(
      `Challenge ${challenge} | difficulty ~${difficulty} hashes ` +
      `| reward ${ethers.formatUnits(reward, 8)} | minted ${ethers.formatUnits(minted, 8)} / 21,000,000`
    );

    // Search nonces locally. Start from a random nonce so two miners rarely
    // collide on the same (challenge, miner, nonce) space.
    let nonce = BigInt(Math.floor(Math.random() * 2 ** 32));
    let tries = 0;
    const started = Date.now();
    let found = null;
    for (;;) {
      const digest = digestFor(challenge, wallet.address, nonce);
      if (BigInt(digest) < targetBig) { found = { nonce, digest }; break; }
      nonce += 1n;
      tries += 1;
      // Re-check the challenge every 200k tries in case someone else mined first.
      if (tries % 200000 === 0) {
        const cur = await token.getChallengeNumber();
        if (cur !== challenge) {
          console.log(`Challenge changed after ${tries} tries — restarting search.`);
          found = null;
          break;
        }
      }
    }
    if (!found) continue; // challenge moved; loop re-reads state

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`Found nonce ${found.nonce} after ${tries} tries in ${secs}s — digest ${found.digest}`);

    try {
      const tx = await token.mint(found.nonce, found.digest);
      console.log("mint tx:", tx.hash);
      const rc = await tx.wait();
      console.log(`Mined! block ${rc.blockNumber} — reward ${ethers.formatUnits(reward, 8)} pBitcoin`);
      mined += 1;
      console.log(`Total minted by this run: ${mined}`);
    } catch (e) {
      // Most likely someone else solved this challenge first (challenge
      // changed under us). Re-read state and try again.
      console.log("mint failed (probably beaten to this challenge):", (e.shortMessage || e.message || e).split("\n")[0]);
    }

    if (once) return;
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
