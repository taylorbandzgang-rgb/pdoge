// PDOGE secure RPC proxy — allowlist-only JSON-RPC filter in front of the node.
//
// Only two things pass through:
//   1. Read-only calls (balance, code, logs, gas estimates, ...)
//   2. eth_sendRawTransaction — transactions SIGNED LOCALLY by the user's wallet.
//      Phantom signs on-device; the proxy never sees a private key.
//
// Everything else is rejected, notably:
//   - eth_sendTransaction (unsigned sends)
//   - anvil_impersonateAccount / hardhat_impersonateAccount (the vault-drainer)
//   - anvil_setBalance, anvil_mine, evm_mine, evm_setAutomine, debug_*, admin_*
// A blocklist can't enumerate every dangerous method; the allowlist can.
//
// Also: simple per-IP rate limiting (120 req/min) and CORS headers for wallets.
//
// Listens on 127.0.0.1:8549 -> forwards to the node at 127.0.0.1:8546.
// Pure node:http — zero dependencies.
import http from "node:http";

const LISTEN_HOST = process.env.PROXY_HOST || "127.0.0.1";
const LISTEN_PORT = parseInt(process.env.PROXY_PORT || "8549", 10);
const TARGET = { host: process.env.TARGET_HOST || "127.0.0.1", port: parseInt(process.env.TARGET_PORT || "8546", 10) };

// Read-only methods a wallet needs. Anything not here (and not
// eth_sendRawTransaction) is rejected.
const READ_METHODS = new Set([
  "web3_clientVersion",
  "net_version",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
  "eth_newFilter",
  "eth_newBlockFilter",
  "eth_newPendingTransactionFilter",
  "eth_uninstallFilter",
]);

const WRITE_METHODS = new Set(["eth_sendRawTransaction"]);

// --- rate limiting: 120 requests / 60s per IP ---
const RATE_LIMIT = 120;
const WINDOW_MS = 60_000;
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT;
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function forward(body, res) {
  const fwd = http.request(
    {
      host: TARGET.host,
      port: TARGET.port,
      path: "/",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 15000,
    },
    (fwdRes) => {
      res.writeHead(fwdRes.statusCode || 200, { "Content-Type": "application/json" });
      fwdRes.pipe(res);
    }
  );
  fwd.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad gateway: PDOGE node unreachable" }));
  });
  fwd.on("timeout", () => fwd.destroy());
  fwd.end(body);
}

const server = http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "POST only" }));
    return;
  }
  const ip = req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    res.writeHead(429, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Rate limited" }));
    return;
  }

  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy(); // sanity cap
  });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const items = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      const m = item?.method;
      if (!READ_METHODS.has(m) && !WRITE_METHODS.has(m)) {
        console.warn(`[proxy] blocked method: ${m} from ${ip}`);
        res.writeHead(403, { ...cors, "Content-Type": "application/json" });
        res.end(jsonRpcError(item?.id, -32601, `Method ${m} is not allowed by the PDOGE RPC proxy`));
        return;
      }
    }
    // Preserve CORS on proxied responses: buffer minimal handling by piping,
    // then set headers first. Simpler: forward and add headers via writeHead override.
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (code, headers) => origWriteHead(code, { ...cors, ...(headers || {}) });
    forward(body, res);
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`PDOGE secure RPC proxy on 127.0.0.1:${LISTEN_PORT} -> 127.0.0.1:8546 (allowlist enforced)`);
});
