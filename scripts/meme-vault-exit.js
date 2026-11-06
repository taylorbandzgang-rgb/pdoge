// MemeVault exit — burn wrapped tokens on PDOGE, release real tokens on mainnet.
//
// Runs ON the GCE VM (it needs the operator key + PDOGE write access to the
// anvil on 127.0.0.1:8545 — port 8546 is the read-only proxy and rejects writes).
//   ENV_FILE=/etc/pdoge/pdoge-relayer.env node meme-vault-exit.js <TOKEN> [AMOUNT|max]
//
// After this script, sell the released tokens on mainnet from the trading
// wallet (scripts/trade.js for V2 coins, scripts/trade-v4.js for GTA).
// NEVER commit .env. The operator key never goes in chat.
import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || "/opt/pdoge/.env" });
import { ethers } from "ethers";

const OPERATOR = "0xD843A526EC1DDc009510c2cd3403f06b2094C356";
const TRADING_WALLET = "0x3AC18362e4bf5902824C805720d3BEE6fecbE5D3";
const MAINNET_VAULT = "0x83A6519B1E3f22cd125bE19301B00a6020C8012d";
const PDOGE_VAULT = "0x5F00bB72952Ade2905AfC163d488eF29E2b4dA1E";
const TOKENS = {
  PEPE: {
    mainnet: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    wrapped: "0xB625D91124dEdf107DDcd001f3A2E9BB821C35e1",
  },
  GTA: {
    mainnet: "0xA7698ac691329F4a611c743CB0FBfCD4A47C58ef",
    wrapped: "0x69a56929cCDbdc47Dc5753c2099Fc7db5a4Ce371",
  },
  PEP: {
    mainnet: "0x5ddf881d025f8c2e98050bf2d922e679999aeb3a",
    wrapped: "0xbD0D56334116c91cf7e49F5f337c0fB2bcFAaBF9",
  },
};
const WRAPPED_ABI = [
  "function burnFrom(address from, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
];
const MAINNET_VAULT_ABI = [
  "function release(address token, address user, uint256 amount)",
  "function locked(address token, address user) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const sym = process.argv[2];
  const amountArg = process.argv[3] || "max";
  if (!TOKENS[sym]) throw new Error("Usage: meme-vault-exit.js <PEPE|GTA|PEP> [AMOUNT|max]");
  const t = TOKENS[sym];
  const key = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!key) throw new Error("Set OPERATOR_PRIVATE_KEY (via ENV_FILE)");

  const pdoge = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const mainnet = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
  const opPdoge = new ethers.Wallet(key, pdoge);
  const opMainnet = new ethers.Wallet(key, mainnet);
  console.log("operator:", opPdoge.address);
  if (opPdoge.address.toLowerCase() !== OPERATOR.toLowerCase()) {
    throw new Error("Operator key mismatch — refusing to run");
  }

  const wrapped = new ethers.Contract(t.wrapped, WRAPPED_ABI, opPdoge);
  const vaultBal = await wrapped.balanceOf(PDOGE_VAULT);
  const amount = amountArg === "max" ? vaultBal : ethers.parseUnits(amountArg, 18);
  if (amount === 0n) throw new Error(`Nothing to exit — PDOGE vault holds 0 ${"w" + sym}`);
  if (amount > vaultBal) throw new Error(`Amount exceeds PDOGE vault balance (${ethers.formatUnits(vaultBal, 18)})`);
  console.log(`Exiting ${ethers.formatUnits(amount, 18)} w${sym} from PDOGE vault ${PDOGE_VAULT}`);

  // 1. Burn the wrapped tokens on PDOGE.
  let nonce = await pdoge.getTransactionCount(opPdoge.address);
  const burnTx = await wrapped.burnFrom(PDOGE_VAULT, amount, { nonce: nonce++ });
  console.log("burn tx:", burnTx.hash);
  await burnTx.wait();
  console.log("wrapped balance in PDOGE vault after burn:", ethers.formatUnits(await wrapped.balanceOf(PDOGE_VAULT), 18));

  // 2. Release the real tokens on mainnet to the trading wallet.
  const mainVault = new ethers.Contract(MAINNET_VAULT, MAINNET_VAULT_ABI, opMainnet);
  const real = new ethers.Contract(t.mainnet, ERC20_ABI, mainnet);
  const before = await real.balanceOf(TRADING_WALLET);
  const relTx = await mainVault.release(t.mainnet, TRADING_WALLET, amount);
  console.log("release tx:", relTx.hash);
  await relTx.wait();
  const after = await real.balanceOf(TRADING_WALLET);
  console.log(`trading wallet ${sym}: ${ethers.formatUnits(before, 18)} -> ${ethers.formatUnits(after, 18)}`);
  console.log(`DONE — ${ethers.formatUnits(amount, 18)} ${sym} back in the trading wallet, ready to sell`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
