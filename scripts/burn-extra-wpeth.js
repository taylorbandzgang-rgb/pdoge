// burn-extra-wpeth.js — destroy the 784,000 unbacked wPETH re-minted by the relayer
// restart (2026-11-05). Method: plain ERC20 transfer from the savings wallet to
// the standard burn address 0x...dEaD. (OpenZeppelin ERC20 rejects transfers to
// address(0) with ERC20InvalidReceiver, so the dead address is used instead.)
// The relayer does NOT watch WrappedPETH Transfer events (it watches
// PDOGEBridge.BurnedForRelease), so this triggers NO PETH release on mainnet.
// DO NOT use bridge.burnForRelease for this — that would release 784,000 real PETH
// from the vault and drain the backing.
// Note: ERC20 transfer does not reduce totalSupply(); the tokens at the burn
// address are permanently unspendable, so the effective circulating supply
// returns to 789,000.
import dotenv from "dotenv";
dotenv.config();
import { ethers } from "ethers";

const WPETH = process.env.WPETH_ADDRESS;
const SAVINGS_ADDR = "0xd42F201ed7502D7AF699E2F523590567899a1Ae9";
const ZERO = "0x000000000000000000000000000000000000dEaD"; // standard burn address
const BURN_AMOUNT = ethers.parseEther("784000");

const provider = new ethers.JsonRpcProvider("https://34.148.123.122.nip.io");
const wallet = new ethers.Wallet(process.env.SAVINGS_PRIVATE_KEY, provider);
const wPETH = new ethers.Contract(
  WPETH,
  [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ],
  wallet
);

const before = await wPETH.balanceOf(SAVINGS_ADDR);
const supplyBefore = await wPETH.totalSupply();
console.log("token:", await wPETH.name(), await wPETH.symbol());
console.log("savings balance before:", ethers.formatEther(before));
console.log("totalSupply before:", ethers.formatEther(supplyBefore));
if (before < BURN_AMOUNT) { console.log("ABORT: balance below burn amount"); process.exit(1); }

// Simulate first — costs nothing.
await wPETH.transfer.staticCall(ZERO, BURN_AMOUNT);
console.log("simulation OK — sending burn transfer...");

const tx = await wPETH.transfer(ZERO, BURN_AMOUNT);
console.log("tx:", tx.hash);
const rc = await tx.wait();
console.log("confirmed block:", rc.blockNumber, "status:", rc.status);
console.log("receipt logs:", rc.logs.length, "(expect 1 Transfer, no BurnedForRelease)");
for (const l of rc.logs) console.log("  log:", l.address, l.topics[0].slice(0, 10));

const after = await wPETH.balanceOf(SAVINGS_ADDR);
const supplyAfter = await wPETH.totalSupply();
console.log("savings balance after:", ethers.formatEther(after));
console.log("totalSupply after (unchanged by ERC20 transfer):", ethers.formatEther(supplyAfter));
console.log("effective circulating supply (excl. zero address):", ethers.formatEther(supplyAfter - BURN_AMOUNT));
