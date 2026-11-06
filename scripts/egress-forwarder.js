// TCP forwarder: makes cloudflared's outbound TLS reachable.
//
// Problem: the network edge intercepts direct outbound TLS ("first record does
// not look like a TLS handshake"), and cloudflared ignores proxy env vars.
// Fix: /etc/hosts points cloudflared's destinations at 127.0.0.x, and this
// forwarder pipes each connection through the runtime egress proxy via an
// (unauthenticated) HTTP CONNECT — the proxy 200s without credentials and
// 407s WITH them, so we send none.
//
// Routing table: local listen address -> real destination (host:port).
// TLS is end-to-end (we're a dumb pipe), so certs/SNI stay valid.
//
// Usage: run as root (needs port 443), with /etc/hosts entries like:
//   127.0.0.1 api.trycloudflare.com
//   127.0.0.2 region1.v2.argotunnel.com
//   127.0.0.3 region2.v2.argotunnel.com
import net from "node:net";

const EGRESS = { host: "hatch-egress-proxy", port: 3128 };

// localIP:localPort -> "realHost:realPort"
const ROUTES = {
  "127.0.0.1:443": "api.trycloudflare.com:443",
  "127.0.0.2:443": "region1.v2.argotunnel.com:443",
  "127.0.0.3:443": "region2.v2.argotunnel.com:443",
};

function viaConnect(dest) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(EGRESS.port, EGRESS.host, () => {
      const [host, port] = dest.split(":");
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("latin1");
      if (buf.includes("\r\n\r\n")) {
        sock.removeListener("data", onData);
        if (/^HTTP\/1\.[01] 200/.test(buf)) {
          resolve(sock);
        } else {
          sock.destroy();
          reject(new Error("CONNECT rejected: " + buf.split("\r\n")[0]));
        }
      }
    };
    sock.on("data", onData);
    sock.on("error", reject);
    sock.setTimeout(15000, () => {
      sock.destroy();
      reject(new Error("CONNECT timeout"));
    });
  });
}

for (const [local, dest] of Object.entries(ROUTES)) {
  const [ip, port] = local.split(":");
  const server = net.createServer(async (client) => {
    client.on("error", () => {});
    try {
      const upstream = await viaConnect(dest);
      upstream.on("error", () => client.destroy());
      client.pipe(upstream).pipe(client);
    } catch (e) {
      console.error(`[fwd] ${local} -> ${dest} failed: ${e.message}`);
      client.destroy();
    }
  });
  server.on("error", (e) => console.error(`[fwd] listen ${local}: ${e.message}`));
  server.listen(Number(port), ip, () => console.log(`[fwd] ${local} -> ${dest}`));
}
