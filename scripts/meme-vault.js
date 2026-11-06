// MemeVault CLI — mainnet side of the trading-portfolio vault.
//
//   node scripts/meme-vault.js deploy                  Deploy MemeVault (owner = operator)
//   node scripts/meme-vault.js approve <TOKEN>         Trading wallet approves vault (max)
//   node scripts/meme-vault.js lock <TOKEN> <AMOUNT>   Trading wallet locks AMOUNT (human units, or "max")
//   node scripts/meme-vault.js release <TOKEN> <AMOUNT> [TO]  Operator releases to TO (default: trading wallet)
//   node scripts/meme-vault.js status                  Vault balances + locked amounts for the 4 pot tokens
//
// Vault address is read from scripts/meme-vault-address.txt (written by deploy)
// or MEME_VAULT_ADDRESS in .env. Keys: TRADING_PRIVATE_KEY + MAINNET_RPC_URL
// from ../pseudoethereum-sepolia/.env, OPERATOR_* from this project's .env.
// NEVER commit .env. Keys never go in chat.
import dotenv from "dotenv";
dotenv.config({ path: "../pseudoethereum-sepolia/.env" });
dotenv.config();
import { readFile, writeFile } from "node:fs/promises";
import { ethers } from "ethers";
import { Sender } from "./tx.js";

const TRADING_WALLET = "0x3AC18362e4bf5902824C805720d3BEE6fecbE5D3";
const OPERATOR = process.env.OPERATOR_ADDRESS || "0xD843A526EC1DDc009510c2cd3403f06b2094C356";
const TOKENS = {
  PEPE: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
  GTA: "0xA7698ac691329F4a611c743CB0FBfCD4A47C58ef",
  SFK: "0x3611d1be8c92622f2b11a83f72b465ab79f9b4f2",
  PEP: "0x5ddf881d025f8c2e98050bf2d922e679999aeb3a",
};
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const VAULT_ABI = [
  "function lock(address token, uint256 amount)",
  "function release(address token, address user, uint256 amount)",
  "function locked(address token, address user) view returns (uint256)",
  "function owner() view returns (address)",
];

async function artifact(name) {
  const raw = await readFile(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8");
  return JSON.parse(raw);
}

async function vaultAddress() {
  if (process.env.MEME_VAULT_ADDRESS) return process.env.MEME_VAULT_ADDRESS;
  try {
    return (await readFile("./scripts/meme-vault-address.txt", "utf8")).trim();
  } catch {
    throw new Error("No vault address yet — run `deploy` first (or set MEME_VAULT_ADDRESS)");
  }
}

function resolveToken(input) {
  if (TOKENS[input]) return { symbol: input, address: TOKENS[input] };
  if (ethers.isAddress(input)) {
    const sym = Object.entries(TOKENS).find(([, a]) => a.toLowerCase() === input.toLowerCase());
    return { symbol: sym ? sym[0] : input, address: input };
  }
  throw new Error(`Unknown token "${input}" (use PEPE, GTA, SFK, PEP, or an address)`);
}

async function main() {
  const cmd = process.argv[2];
  const rpc = process.env.MAINNET_RPC_URL || "";
  if (!rpc) throw new Error("Set MAINNET_RPC_URL (in ../pseudoethereum-sepolia/.env)");
  const provider = new ethers.JsonRpcProvider(rpc);

  if (cmd === "deploy") {
    const key = process.env.TRADING_PRIVATE_KEY || "";
    if (!key) throw new Error("Set TRADING_PRIVATE_KEY");
    const wallet = new ethers.Wallet(key, provider);
    const sender = new Sender(provider, wallet);
    await sender.init();
    console.log("Deploying MemeVault from trading wallet:", wallet.address);
    console.log("Owner (operator) will be:", OPERATOR);
    const bal = await provider.getBalance(wallet.address);
    console.log("Deployer balance:", ethers.formatEther(bal), "ETH");
    const { abi, bytecode } = await artifact("MemeVault");
    const vault = await sender.deploy(abi, bytecode, OPERATOR);
    const addr = await vault.getAddress();
    console.log("MemeVault deployed to:", addr);
    console.log("Owner on-chain:", await vault.owner());
    await writeFile("./scripts/meme-vault-address.txt", addr + "\n");
    console.log("Address saved to scripts/meme-vault-address.txt");
    return;
  }

  if (cmd === "status") {
    const addr = await vaultAddress();
    const vault = new ethers.Contract(addr, VAULT_ABI, provider);
    console.log("MemeVault:", addr, "| owner:", await vault.owner());
    for (const [sym, taddr] of Object.entries(TOKENS)) {
      const tok = new ethers.Contract(taddr, ERC20_ABI, provider);
      const [vbal, locked, wbal] = await Promise.all([
        tok.balanceOf(addr),
        vault.locked(taddr, TRADING_WALLET),
        tok.balanceOf(TRADING_WALLET),
      ]);
      console.log(`${sym}: vault=${ethers.formatUnits(vbal, 18)} locked[trading]=${ethers.formatUnits(locked, 18)} tradingWallet=${ethers.formatUnits(wbal, 18)}`);
    }
    return;
  }

  if (cmd === "approve" || cmd === "lock") {
    const { symbol, address } = resolveToken(process.argv[3]);
    const key = process.env.TRADING_PRIVATE_KEY || "";
    if (!key) throw new Error("Set TRADING_PRIVATE_KEY");
    const wallet = new ethers.Wallet(key, provider);
    const sender = new Sender(provider, wallet);
    await sender.init();
    const addr = await vaultAddress();
    const tok = new ethers.Contract(address, ERC20_ABI, wallet);
    if (cmd === "approve") {
      const r = await sender.call(tok, "approve", addr, ethers.MaxUint256);
      console.log(`Approved ${symbol} for vault ${addr} (tx ${r.hash})`);
      return;
    }
    const amountArg = process.argv[4];
    if (!amountArg) throw new Error("Usage: lock <TOKEN> <AMOUNT|max>");
    const amount = amountArg === "max"
      ? await tok.balanceOf(wallet.address)
      : ethers.parseUnits(amountArg, 18);
    if (amount === 0n) throw new Error("Nothing to lock (balance is 0)");
    const vault = new ethers.Contract(addr, VAULT_ABI, wallet);
    const r = await sender.call(vault, "lock", address, amount);
    console.log(`Locked ${ethers.formatUnits(amount, 18)} ${symbol} into ${addr} (tx ${r.hash})`);
    return;
  }

  if (cmd === "release") {
    const { symbol, address } = resolveToken(process.argv[3]);
    const amountArg = process.argv[4];
    if (!amountArg) throw new Error("Usage: release <TOKEN> <AMOUNT> [TO]");
    const to = process.argv[5] || TRADING_WALLET;
    const key = process.env.OPERATOR_PRIVATE_KEY || "";
    if (!key) throw new Error("Set OPERATOR_PRIVATE_KEY");
    const wallet = new ethers.Wallet(key, provider);
    const sender = new Sender(provider, wallet);
    await sender.init();
    const addr = await vaultAddress();
    const vault = new ethers.Contract(addr, VAULT_ABI, wallet);
    const amount = ethers.parseUnits(amountArg, 18);
    const r = await sender.call(vault, "release", address, to, amount);
    console.log(`Released ${amountArg} ${symbol} to ${to} (tx ${r.hash})`);
    return;
  }

  throw new Error("Usage: deploy | approve <TOKEN> | lock <TOKEN> <AMOUNT|max> | release <TOKEN> <AMOUNT> [TO] | status");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
