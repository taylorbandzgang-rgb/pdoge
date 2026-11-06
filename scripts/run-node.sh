#!/usr/bin/env bash
# Start the PseudoDogecoin node (chain ID 42069, port 8546).
set -euo pipefail
cd "$(dirname "$0")/.."
npx hardhat node --port 8546 --chain-id 42069
