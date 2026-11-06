// wpeth-faucet-server.js — Dollar Dash wPETH micro-faucet (chain 42069).
//
// POST /faucet/claim  { "address": "0x...", "score": 412 }
//   -> { "ok": true, "txHash": "0x..." }
//   -> { "ok": false, "error": "score_too_low" | "already_claimed_today" |
//                            "daily_cap_reached" | "faucet_empty" | "bad_address" | ... }
// GET  /faucet/health -> { ok, faucet, wpethBalance, claimsToday, minScore }
//
// Trust model (stated honestly): the game runs client-side, so scores cannot be
// cryptographically verified server-side. Abuse is bounded by 1 claim per
// address per 24h, a per-IP rate limit, and a global daily cap. Payouts are
// dust (1 wPETH), so this is proportionate.
//
// Env: FAUCET_PRIVATE_KEY (required), PDOGE_RPC_URL (default http://127.0.0.1:8545),
//      FAUCET_PORT (default 8099), FAUCET_PAYOUT_WPETH (default "1"),
//      FAUCET_MIN_SCORE (default 400), FAUCET_DAILY_CAP (default 500).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FAUCET_PORT || 8099);
const RPC_URL = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8545";
const WPETH = "0x079dF29BC26502b9476b4a044F7cb61a4e8CC7Be";
const PAYOUT = ethers.parseEther(process.env.FAUCET_PAYOUT_WPETH || "1");
const MIN_SCORE = Number(process.env.FAUCET_MIN_SCORE || 400);
const COOLDOWN_MS = 24 * 3600 * 1000;
const DAILY_CAP = Number(process.env.FAUCET_DAILY_CAP || 500);
const STATE_FILE = path.join(__dirname, "faucet-claims.json");

const key = (process.env.FAUCET_PRIVATE_KEY || "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("FAUCET_PRIVATE_KEY not set or invalid — refusing to start");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(key, provider);
const wpeth = new ethers.Contract(
  WPETH,
  [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ],
  wallet
);

let state = {};
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
} catch { /* fresh start */ }
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));

// Track the nonce locally: the node can serve a receipt before its
// account-nonce state catches up, so back-to-back sends must not rely on
// the node-reported nonce (see AGENTS.md).
let nonce = null;
async function nextNonce() {
  if (nonce === null) nonce = await provider.getTransactionCount(wallet.address, "pending");
  return nonce++;
}

// Per-IP rate limit: 20 claims/hour.
const ipHits = new Map();
function ipOk(ip) {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (arr.length >= 20) return false;
  arr.push(now);
  ipHits.set(ip, arr);
  return true;
}

function claimsToday() {
  const day = new Date().toISOString().slice(0, 10);
  return Object.values(state).filter((c) => c.day === day).length;
}

function json(res, code, obj) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (req.method === "GET" && url.pathname === "/faucet/health") {
    wpeth
      .balanceOf(wallet.address)
      .then((bal) =>
        json(res, 200, {
          ok: true,
          faucet: wallet.address,
          wpethBalance: ethers.formatEther(bal),
          claimsToday: claimsToday(),
          dailyCap: DAILY_CAP,
          minScore: MIN_SCORE,
        })
      )
      .catch(() => json(res, 500, { ok: false, error: "rpc_down" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/faucet/claim") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", async () => {
      try {
        const ip =
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          "unknown";
        if (!ipOk(ip)) return json(res, 429, { ok: false, error: "rate_limited" });

        const { address, score } = JSON.parse(body || "{}");
        if (!address || !ethers.isAddress(address))
          return json(res, 400, { ok: false, error: "bad_address" });
        const s = Number(score);
        if (!Number.isInteger(s) || s < MIN_SCORE)
          return json(res, 400, { ok: false, error: "score_too_low" });

        const addr = address.toLowerCase();
        const last = state[addr]?.ts || 0;
        if (Date.now() - last < COOLDOWN_MS)
          return json(res, 429, { ok: false, error: "already_claimed_today" });
        if (claimsToday() >= DAILY_CAP)
          return json(res, 503, { ok: false, error: "daily_cap_reached" });

        const bal = await wpeth.balanceOf(wallet.address);
        if (bal < PAYOUT)
          return json(res, 503, { ok: false, error: "faucet_empty" });

        const tx = await wpeth.transfer(address, PAYOUT, { nonce: await nextNonce() });
        state[addr] = {
          ts: Date.now(),
          day: new Date().toISOString().slice(0, 10),
          tx: tx.hash,
        };
        save();
        tx.wait().catch((e) => console.error("confirm failed", tx.hash, e.message));
        return json(res, 200, { ok: true, txHash: tx.hash });
      } catch (e) {
        if (/nonce/i.test(e.message || "")) nonce = null; // resync on nonce errors
        console.error("claim failed:", e.message);
        return json(res, 500, { ok: false, error: "payout_failed" });
      }
    });
    return;
  }

  return json(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`wPETH faucet listening on 127.0.0.1:${PORT} as ${wallet.address}`)
);
