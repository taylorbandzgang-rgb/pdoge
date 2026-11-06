#!/usr/bin/env bash
# Start the PseudoDogecoin node (Anvil) with disk-persisted chain state.
# State dumps to chain-state.json on graceful shutdown (SIGTERM) and reloads
# on start, so restarts no longer wipe deployed contracts or balances.
set -euo pipefail
STATE="/home/hatch/workspace/pseudodogecoin/chain-state.json"
ARGS=(--host 127.0.0.1 --port 8546 --chain-id 42069 --dump-state "$STATE")
if [ -f "$STATE" ]; then
  ARGS+=(--load-state "$STATE")
fi
exec /home/hatch/.foundry/bin/anvil "${ARGS[@]}"
