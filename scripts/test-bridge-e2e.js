// End-to-end bridge test on local chains (no real money).
// Fork (L1): impersonate Domenic's Phantom (holds real PETH on mainnet).
import { ethers } from "ethers";
import { readFile } from "node:fs/promises";

const FORK = "http://127.0.0.1:8547";
const PDOGE = "http://127.0.0.1:8546";
const PHANTOM = "0x1bbae640072033ee04414d1e980dca180b6aef75";
const PETH = "0x34fDfEf7F661e95B10F821173763cd4C0d1974ca";
const VAULT = "0x079dF29BC26502b9476b4a044F7cb61a4e8CC7Be";
const WPETH = "0x079dF29BC26502b9476b4a044F7cb61a4e8CC7Be";
const BRIDGE = "0x39aF719f84B731a6a608577ED9F3EA0F01ff9bD2";
const AMT = ethers.parseUnits("1000", 18);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function abi(name) {
  return JSON.parse(await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8")).abi;
}
// Raw impersonated send: works with hardhat_impersonateAccount where ethers getSigner refuses.
async function impSend(provider, from, to, data) {
  const hash = await provider.send("eth_sendTransaction", [{ from, to, data }]);
  return provider.waitForTransaction(hash);
}

const fork = new ethers.JsonRpcProvider(FORK);
const pdoge = new ethers.JsonRpcProvider(PDOGE);

// Fund Phantom with PDOGE gas on the fresh PDOGE chain.
// Uses the local node's first unlocked account (Hardhat/anvil test account) —
// no private key is stored here. Local testing only.
{
  const funder = await pdoge.getSigner(0);
  await (await funder.sendTransaction({ to: PHANTOM, value: ethers.parseEther("1") })).wait();
}

// 1. Lock 1000 real PETH on the fork
await fork.send("hardhat_impersonateAccount", [PHANTOM]);
const pethAbi = ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const peth = new ethers.Contract(PETH, pethAbi, fork);
const before = await peth.balanceOf(PHANTOM);
console.log("Phantom PETH on fork before:", ethers.formatUnits(before, 18));
const vaultIface = new ethers.Interface(await abi("PETHVault"));
await impSend(fork, PHANTOM, PETH, new ethers.Interface(pethAbi).encodeFunctionData("approve", [VAULT, AMT]));
await impSend(fork, PHANTOM, VAULT, vaultIface.encodeFunctionData("lock", [AMT]));
console.log("Locked 1000 PETH in vault on fork.");

// 2. Wait for relayer -> wPETH on PDOGE
const wPETH = new ethers.Contract(WPETH, await abi("WrappedPETH"), pdoge);
let wBal = 0n;
for (let i = 0; i < 25 && wBal === 0n; i++) { await sleep(2000); wBal = await wPETH.balanceOf(PHANTOM); }
console.log("Phantom wPETH on PDOGE:", ethers.formatUnits(wBal, 18));
if (wBal !== AMT) throw new Error("mint relay failed");

// 3. Burn wPETH on PDOGE to go back
await pdoge.send("hardhat_impersonateAccount", [PHANTOM]);
const bridgeIface = new ethers.Interface(await abi("PDOGEBridge"));
await impSend(pdoge, PHANTOM, BRIDGE, bridgeIface.encodeFunctionData("burnForRelease", [AMT]));
console.log("Burned 1000 wPETH on PDOGE.");

// 4. Wait for relayer -> PETH released on fork
let after = before - AMT;
for (let i = 0; i < 25 && after < before; i++) { await sleep(2000); after = await peth.balanceOf(PHANTOM); }
console.log("Phantom PETH on fork after:", ethers.formatUnits(after, 18));
if (after !== before) throw new Error("release relay failed");

console.log("BIDIRECTIONAL BRIDGE TEST PASSED");
