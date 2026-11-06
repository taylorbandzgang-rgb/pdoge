#!/usr/bin/env bash
# GCE first-boot setup for the PDOGE node (Ubuntu 22.04). Run ONCE on the fresh
# VM as the 'hatch' user (or any sudoer). Installs Node 24 + Foundry, creates
# /opt/pdoge, and writes the systemd units. The chain bundle (chain-state.json,
# .env, artifacts, scripts) is scp'd separately, then units are started.
set -euo pipefail

echo "== installing Node 24 =="
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version

echo "== installing Foundry (anvil) =="
curl -L https://foundry.paradigm.xyz | bash
export PATH="$HOME/.foundry/bin:$PATH"
"$HOME/.foundry/bin/foundryup"
"$HOME/.foundry/bin/anvil" --version

echo "== creating /opt/pdoge =="
sudo mkdir -p /opt/pdoge
sudo chown "$(whoami):$(whoami)" /opt/pdoge

echo "== writing systemd units =="
sudo tee /etc/systemd/system/pdoge-node.service > /dev/null <<'EOF'
[Unit]
Description=PseudoDogecoin node (Anvil, chain 42069)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hatch
WorkingDirectory=/opt/pdoge
ExecStart=/home/hatch/.foundry/bin/anvil --host 127.0.0.1 --port 8545 --chain-id 42069 --dump-state /opt/pdoge/chain-state.json --load-state /opt/pdoge/chain-state.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/pdoge-rpc-proxy.service > /dev/null <<'EOF'
[Unit]
Description=PDOGE secure RPC proxy (allowlist, public :8546)
After=pdoge-node.service
BindsTo=pdoge-node.service

[Service]
Type=simple
User=hatch
WorkingDirectory=/opt/pdoge
Environment=PROXY_HOST=0.0.0.0
Environment=PROXY_PORT=8546
Environment=TARGET_HOST=127.0.0.1
Environment=TARGET_PORT=8545
ExecStart=/usr/bin/node scripts/rpc-proxy.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/pdoge-relayer.service > /dev/null <<'EOF'
[Unit]
Description=PDOGE bridge relayer (L1 <-> PDOGE)
After=pdoge-node.service
BindsTo=pdoge-node.service

[Service]
Type=simple
User=hatch
WorkingDirectory=/opt/pdoge
Environment=PDOGE_RPC_URL=http://127.0.0.1:8545
ExecStart=/usr/bin/node scripts/relayer.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable pdoge-node.service pdoge-rpc-proxy.service pdoge-relayer.service
echo "== done. Next: scp the bundle to /opt/pdoge, then: sudo systemctl start pdoge-node pdoge-rpc-proxy pdoge-relayer =="
