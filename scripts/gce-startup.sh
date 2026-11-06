#!/bin/bash
# PDOGE GCE first-boot setup — runs once as root from instance metadata.
# Installs Node 24 + Foundry, fetches the private chain bundle from GCS,
# and starts the node, public allowlist proxy (:8546) and bridge relayer.
exec > /var/log/pdoge-setup.log 2>&1
set -x

BUCKET="pdoge-bundle-7f3a9c2e"
APPDIR=/opt/pdoge

apt-get update
apt-get install -y curl jq

echo "== Node 24 =="
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
node --version

echo "== Foundry =="
curl -L https://foundry.paradigm.xyz | sudo -u hatch bash
sudo -u hatch /home/hatch/.foundry/bin/foundryup
sudo -u hatch /home/hatch/.foundry/bin/anvil --version

echo "== fetching bundle from GCS =="
TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/bundle.tar.gz?alt=media" \
  -o /tmp/bundle.tar.gz
ls -lh /tmp/bundle.tar.gz
tar xzf /tmp/bundle.tar.gz -C /
# Belt and suspenders: tar can restore odd modes on the directory itself.
# The services run as User=hatch and need to chdir here.
chown -R hatch:hatch "$APPDIR"
chmod 755 "$APPDIR"
chmod -R u+rwX,go+rX "$APPDIR"
ls -lh "$APPDIR/chain-state.json" "$APPDIR/.env"

echo "== node deps =="
cd "$APPDIR" && sudo -u hatch npm install --no-audit --no-fund

echo "== systemd units =="
cat > /etc/systemd/system/pdoge-node.service <<'EOF'
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

cat > /etc/systemd/system/pdoge-rpc-proxy.service <<'EOF'
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

cat > /etc/systemd/system/pdoge-relayer.service <<'EOF'
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

systemctl daemon-reload
systemctl enable --now pdoge-node.service pdoge-rpc-proxy.service pdoge-relayer.service

echo "== verifying =="
sleep 20
echo "--- node status ---"
systemctl is-active pdoge-node.service
echo "--- proxy public check (eth_chainId, expect 0xa455) ---"
curl -s -X POST http://127.0.0.1:8546 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' || echo "PROXY_CHECK_FAILED"
echo "--- relayer status ---"
systemctl is-active pdoge-relayer.service
echo "PDOGE_SETUP_COMPLETE"
