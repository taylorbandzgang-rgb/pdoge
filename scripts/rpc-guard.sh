#!/usr/bin/env bash
# PDOGE RPC guard + recovery watchdog.
# - Ensures the pdoge-node systemd unit exists (reinstalls from the canonical
#   copy in ~/workspace/pseudodogecoin/systemd/ after a VM replacement).
# - Ensures the service is active.
# - Health-checks the RPC; restarts the service if it stops answering.
# Prints only when it takes action; quiet on success (cron stays silent).
set -uo pipefail

UNIT_SRC="/home/hatch/workspace/pseudodogecoin/systemd/pdoge-node.service"
UNIT_DST="/etc/systemd/system/pdoge-node.service"
RPC="http://127.0.0.1:8546/"
ACTED=0

if [ ! -f "$UNIT_DST" ]; then
  cp "$UNIT_SRC" "$UNIT_DST"
  systemctl daemon-reload
  systemctl enable pdoge-node.service >/dev/null 2>&1
  echo "guard: reinstalled pdoge-node unit (post-replacement recovery)"
  ACTED=1
fi

if [ "$(systemctl is-active pdoge-node.service 2>/dev/null)" != "active" ]; then
  systemctl start pdoge-node.service
  echo "guard: started pdoge-node service"
  ACTED=1
  sleep 8
fi

if ! curl -s -m 10 -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    "$RPC" | grep -q "0xa455"; then
  systemctl restart pdoge-node.service
  echo "guard: RPC unhealthy, restarted pdoge-node service"
  ACTED=1
fi

# Relayer guard (only when the bridge is configured for live relay)
if grep -q "^VAULT_ADDRESS=0x" /home/hatch/workspace/pseudodogecoin/.env 2>/dev/null; then
  if [ ! -f /etc/systemd/system/pdoge-relayer.service ]; then
    cp /home/hatch/workspace/pseudodogecoin/systemd/pdoge-relayer.service /etc/systemd/system/pdoge-relayer.service
    chmod 600 /etc/systemd/system/pdoge-relayer.service
    systemctl daemon-reload
    systemctl enable pdoge-relayer.service >/dev/null 2>&1
    echo "guard: reinstalled pdoge-relayer unit (post-replacement recovery)"
    ACTED=1
  fi
  if [ "$(systemctl is-active pdoge-relayer.service 2>/dev/null)" != "active" ]; then
    systemctl start pdoge-relayer.service
    echo "guard: started pdoge-relayer service"
    ACTED=1
  fi
fi

# Final state check: if we acted and something is still broken, say so loudly.
if [ "$ACTED" = "1" ]; then
  sleep 8
  if [ "$(systemctl is-active pdoge-node.service 2>/dev/null)" != "active" ]; then
    echo "guard: FAILED to restore pdoge-node service"
    exit 1
  fi
  if grep -q "^VAULT_ADDRESS=0x" /home/hatch/workspace/pseudodogecoin/.env 2>/dev/null; then
    if [ "$(systemctl is-active pdoge-relayer.service 2>/dev/null)" != "active" ]; then
      echo "guard: FAILED to restore pdoge-relayer service"
      exit 1
    fi
  fi
fi
exit 0
