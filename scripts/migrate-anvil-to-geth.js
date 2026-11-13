// Convert an anvil_dumpState output into a geth Clique genesis.json.
// Input: the hex string from `cast rpc anvil_dumpState` (saved as a file).
// Output: genesis.json with the same chainId, the same accounts (balance/nonce/code/storage),
// and a Clique config with the given signer(s).
//
// EVM-VERSION SWAP: geth 1.13 Clique cannot execute PUSH0 (Shanghai, solc 0.8.24
// default). The contracts must run as Paris bytecode. If --bytecode-map is given
// (a JSON file: {contractName: parisRuntimeBytecode}) and --addr-map is given
// (a JSON file: {addressLower: contractName}), the converter REPLACES the code
// of each listed address with the Paris runtime bytecode for that contract,
// keeping the same address, balance, nonce, and storage. Storage layout is
// identical between Paris and Shanghai for the same source+solc version.
// Local test only.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const DUMP_FILE = process.argv[2] || "/tmp/dumpstate.json";
const OUT_FILE = process.argv[3] || "/home/hatch/workspace/pdoge-multinode-test/genesis.json";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "42069", 10);
const SIGNERS = (process.env.SIGNERS || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266").split(",").map((s) => s.trim().toLowerCase());
// Optional: --bytecode-map <file> --addr-map <file>
let bytecodeMap = {};
let addrMap = {};
for (let i = 4; i < process.argv.length; i++) {
  if (process.argv[i] === "--bytecode-map") bytecodeMap = JSON.parse(readFileSync(process.argv[++i], "utf8"));
  if (process.argv[i] === "--addr-map") addrMap = JSON.parse(readFileSync(process.argv[++i], "utf8"));
}

const raw = readFileSync(DUMP_FILE, "utf8").trim().replace(/^"|"$/g, "");
// Accept both a bare hex string and a JSON-RPC response {"result": "0x..."}.
// (The VM's curl-based dump is a JSON-RPC response; cast's output is bare hex.)
let hex;
if (raw.startsWith("{")) {
  const parsed = JSON.parse(raw);
  hex = parsed.result || parsed;
  if (typeof hex !== "string") throw new Error("dump file is JSON but has no string result field");
} else {
  hex = raw;
}
hex = hex.startsWith("0x") ? hex.slice(2) : hex;
const state = JSON.parse(gunzipSync(Buffer.from(hex, "hex")).toString("utf8"));

const alloc = {};
let kept = 0, skipped = 0, swapped = 0;
for (const [addr, acct] of Object.entries(state.accounts || {})) {
  const balance = BigInt(acct.balance || "0x0");
  const nonce = acct.nonce || 0;
  let code = acct.code || "0x";
  const storage = {};
  for (const [slot, val] of Object.entries(acct.storage || {})) {
    if (BigInt(val) !== 0n) storage[slot.toLowerCase()] = val.toLowerCase();
  }
  const hasState = balance !== 0n || nonce !== 0 || (code && code !== "0x") || Object.keys(storage).length > 0;
  if (!hasState) { skipped++; continue; }
  kept++;
  // Swap in Paris bytecode for known contracts (same address + storage).
  const lower = addr.toLowerCase();
  if (addrMap[lower] && bytecodeMap[addrMap[lower]]) {
    code = bytecodeMap[addrMap[lower]].toLowerCase();
    swapped++;
    console.log(`  swapped ${addr} -> ${addrMap[lower]} (Paris bytecode, ${code.length} chars)`);
  }
  const entry = { balance: "0x" + balance.toString(16) };
  if (nonce !== 0) entry.nonce = "0x" + nonce.toString(16);
  if (code && code !== "0x") entry.code = code;
  if (Object.keys(storage).length > 0) entry.storage = storage;
  alloc[lower] = entry;
}
console.log(`accounts in dump: ${Object.keys(state.accounts || {}).length}, kept in alloc: ${kept}, skipped (empty): ${skipped}, bytecode swapped: ${swapped}`);

// Clique extradata: 32 bytes vanity + signer addresses (20B each) + 65 bytes sig
const vanity = "00".repeat(32);
const signersHex = SIGNERS.map((s) => s.replace(/^0x/, "")).join("");
const sig = "00".repeat(65);
const extradata = "0x" + vanity + signersHex + sig;

const genesis = {
  config: {
    chainId: CHAIN_ID,
    homesteadBlock: 0,
    eip150Block: 0,
    eip155Block: 0,
    eip158Block: 0,
    byzantiumBlock: 0,
    constantinopleBlock: 0,
    petersburgBlock: 0,
    istanbulBlock: 0,
    berlinBlock: 0,
    londonBlock: 0,
    // NO Shanghai/Cancun: geth 1.13 Clique does NOT support any post-merge
    // fork. Enabling shanghaiTime makes block sync fail with
    // "clique does not support shanghai fork", and eth_call crashes with
    // "unexpected withdrawal hash value in clique". The chain must stay on
    // pre-Shanghai forks (up to London). The contracts are compiled for
    // Paris (evm_version paris, no PUSH0), so they do not need Shanghai.
    // Do NOT add shanghaiTime or cancunTime here.
    clique: { period: 5, epoch: 30000 },
  },
  nonce: "0x0",
  timestamp: "0x0",
  extraData: extradata,
  gasLimit: "0x1c9c380",
  difficulty: "0x1",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  coinbase: "0x0000000000000000000000000000000000000000",
  alloc,
};
writeFileSync(OUT_FILE, JSON.stringify(genesis, null, 2));
console.log("wrote", OUT_FILE, "signers:", SIGNERS.join(", "));
console.log("alloc addresses:", Object.keys(alloc).join(", "));
