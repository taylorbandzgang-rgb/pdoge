#!/usr/bin/env bash
# Public tunnel for the PDOGE secure RPC proxy (127.0.0.1:8549).
# Uses a Cloudflare quick tunnel: free, no account. The public URL is random
# per start and written to tunnel-url.txt (the watchdog reads it).
# NOTE: quick-tunnel URLs are ephemeral — they change whenever this restarts.
# A stable address needs a named tunnel (Cloudflare account), a future upgrade.
set -euo pipefail
URL_FILE="/home/hatch/workspace/pseudodogecoin/tunnel-url.txt"
LOG_FILE="/home/hatch/workspace/pseudodogecoin/tunnel.log"
rm -f "$URL_FILE"
/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8549 >"$LOG_FILE" 2>&1 &
TUNNEL_PID=$!
# Extract the public URL from cloudflared's log (up to 60s).
for _ in $(seq 1 60); do
  URL=$(grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" "$LOG_FILE" | head -1 || true)
  if [ -n "$URL" ]; then
    echo "$URL" > "$URL_FILE"
    echo "tunnel up: $URL"
    break
  fi
  sleep 1
done
if [ ! -f "$URL_FILE" ]; then
  echo "tunnel failed to start, see $LOG_FILE" >&2
  kill "$TUNNEL_PID" 2>/dev/null || true
  exit 1
fi
wait "$TUNNEL_PID"
