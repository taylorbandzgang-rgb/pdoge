# Run a PDOGE Node

PDOGE is a live, public EVM chain. Anyone can run a node and join it. Four steps, about ten minutes.

## What you need

| | |
|---|---|
| **Chain ID** | `42069` |
| **Geth** | **1.13.15 exactly** — geth 1.17+ dropped Clique, it will refuse this chain |
| **Genesis** | `genesis.json` in this repo, or https://34.148.123.122.nip.io/site/genesis.json — same file, md5 `041c85e8fc1015d52b4a952abf1a2c5d` |
| **Bootnode** | `enode://ba923083b792a691989c387fdcaa94dce24f9df349cbddf6c8d21011295426457ceb390aeb6bd527a344ee72cf49e40df4cddfaeba2fc66f3a0a0b6b27fff56f@34.148.123.122:30303` |

## Step 1 — Install geth 1.13.15

```bash
curl -LO https://gethstore.blob.core.windows.net/builds/geth-linux-amd64-1.13.15-c5ba367e.tar.gz
tar xzf geth-linux-amd64-1.13.15-c5ba367e.tar.gz
sudo cp geth-linux-amd64-1.13.15-c5ba367e/geth /usr/local/bin/geth113
geth113 version   # expect: Geth, Version: 1.13.15-stable
```

We install it as `geth113` so it doesn't clash with any other geth on your machine. Do not use a newer geth.

## Step 2 — Get the genesis and initialise

```bash
curl -LO https://raw.githubusercontent.com/taylorbandzgang-rgb/pdoge/main/genesis.json
geth113 --datadir ./pdoge-data init genesis.json
```

This loads the full live state: every contract, every balance, the MemeVault, the pools, the farm — all at the same addresses as the live chain.

## Step 3 — Start the node and connect to the bootnode

```bash
geth113 --datadir ./pdoge-data \
  --networkid 42069 \
  --port 30303 \
  --http --http.addr 127.0.0.1 --http.port 8545 \
  --http.api eth,net,web3,clique,admin \
  --syncmode full
```

Then, in a second terminal, attach and add the bootnode:

```bash
geth113 attach ./pdoge-data/geth.ipc
> admin.addPeer("enode://ba923083b792a691989c387fdcaa94dce24f9df349cbddf6c8d21011295426457ceb390aeb6bd527a344ee72cf49e40df4cddfaeba2fc66f3a0a0b6b27fff56f@34.148.123.122:30303")
```

Discovery is on, so your node may find peers on its own — if it hasn't peered up within a minute, `admin.addPeer` above is the reliable path. Make sure TCP/UDP **30303** is reachable from the internet, or your node can't be dialled back.

## Step 4 — Check you're synced

```bash
> eth.chainId      # 42069
> eth.syncing      # false when caught up
> eth.blockNumber  # should match the live chain
```

That's it — you're on the live chain. To use it in MetaMask: RPC `https://34.148.123.122.nip.io`, chain ID `42069`, symbol `PDOGE`.

## Want to seal blocks?

The chain has a single signer today (the operator, `0xD843A526EC1DDc009510c2cd3403f06b2094C356`). New validators are voted in by the existing signers — no token stake, just a vote. Run a reliable synced node, then open a GitHub issue with your node's enode and address, and an existing signer will propose you with `clique.propose("0xYourAddress", true)`.

## Gas: you need PDOGE, not PETH

PDOGE is the chain's native gas token. **PETH cannot pay for gas** — it's an ERC20 on Ethereum mainnet. To get starter PDOGE, open a GitHub issue with your PDOGE address and the operator will fund enough for gas. (A public PDOGE faucet is a good first contribution — see `CONTRIBUTING.md`.)

## If it breaks

- **"Geth only supports PoS networks"** — you're on geth 1.17+. Use 1.13.15.
- **"clique does not support shanghai fork"** — wrong genesis or geth too new. Use the genesis above and geth 1.13.15. The chain is pre-Shanghai by design.
- **Node won't peer** — check TCP/UDP 30303 is open, then `admin.addPeer` with the enode above. If your enode shows `discport=0`, you started with `--nodiscover`; restart without it.
- **Wrong chain / empty state** — you initialised with the wrong genesis. Wipe it (`rm -rf ./pdoge-data`) and re-init with the genesis from this repo.
