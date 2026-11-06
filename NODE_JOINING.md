# Run Your Own PDOGE Node

PDOGE is a live, public EVM chain (chain ID **42069**) running **geth 1.13 Clique (Proof-of-Authority)**. Anyone can run a node and join the network. This guide gets you synced.

> **You need geth 1.13.x.** Geth 1.17+ dropped Clique support ("Geth only supports PoS networks"), so do not use a newer geth. Use **1.13.15**.

## Quick start

### 1. Install geth 1.13.15

Download the Linux amd64 build from the Geth release archive:

```bash
curl -LO https://gethstore.blob.core.windows.net/builds/geth-linux-amd64-1.13.15-c5ba367e.tar.gz
tar xzf geth-linux-amd64-1.13.15-c5ba367e.tar.gz
sudo cp geth-linux-amd64-1.13.15-c5ba367e/geth /usr/local/bin/geth113
geth113 version   # expect: Geth, Version: 1.13.15-stable
```

### 2. Get the genesis file

Download it from the repo or the live site — both are the same file (SHA-256 of the live genesis; md5 `041c85e8fc1015d52b4a952abf1a2c5d`):

```bash
curl -LO https://raw.githubusercontent.com/taylorbandzgang-rgb/pdoge/main/genesis.json
# or: curl -LO https://34.148.123.122.nip.io/site/genesis.json
```

### 3. Initialise your node

```bash
geth113 --datadir ./pdoge-data init genesis.json
```

This loads the full live state: every contract, every balance, the MemeVault, the pools, the farm — all at the same addresses as the live chain.

### 4. Start the node and join the network

Connect to the validator (the bootnode) with `admin_addPeer`, then let it sync:

```bash
geth113 --datadir ./pdoge-data \
  --networkid 42069 \
  --port 30303 \
  --http --http.addr 127.0.0.1 --http.port 8545 \
  --http.api eth,net,web3,clique,admin \
  --syncmode full
```

Then attach and add the bootnode (in a second terminal):

```bash
geth113 attach ./pdoge-data/geth.ipc
> admin.addPeer("enode://ba923083b792a691989c387fdcaa94dce24f9df349cbddf6c8d21011295426457ceb390aeb6bd527a344ee72cf49e40df4cddfaeba2fc66f3a0a0b6b27fff56f@34.148.123.122:30303")
> eth.syncing        # watch progress; false when caught up
> eth.blockNumber    # should match the live chain
```

> **Discovery is on.** The validator advertises itself, so your node should also find peers on its own. If it doesn't peer up within a minute, `admin.addPeer` with the enode above is the reliable path. Make sure TCP/UDP **30303** is reachable from the internet on your machine or your node can't be dialled back.

### 5. Verify you're on the live chain

```bash
> eth.chainId         # 42069
> eth.getBalance("0xD843A526EC1DDc009510c2cd3403f06b2094C356")  # operator, ~44,999 PDOGE
> eth.getCode("0x36ae241Ed75b5fD2EaBbB5F9033d94663a4A9D37")    # WrappedPETH — non-empty
```

Add the network to MetaMask to use it: RPC `https://34.148.123.122.nip.io`, chain ID `42069`, symbol `PDOGE`.

## Becoming a validator

The chain starts with a single signer (the operator, `0xD843…`). New validators are voted in by the existing signers via Clique's signer voting — there is no token stake, just a vote. If you run a reliable node and want to seal blocks:

1. Run your node for a while and keep it synced.
2. Open a GitHub issue in this repo with your node's enode and address.
3. An existing signer proposes you with `clique.propose("0xYourAddress", true)`. Once a majority of signers vote you in, your node starts sealing.

## Gas: you need PDOGE, not PETH

PDOGE is the chain's native gas token. **PETH cannot pay for gas** — it's an ERC20 on Ethereum mainnet, not the chain's currency. New node operators need a small amount of PDOGE to send transactions.

Right now the way to get starter PDOGE is to ask: open a GitHub issue with your PDOGE address and the operator will fund enough for gas. A public PDOGE faucet is a good first contribution (see `CONTRIBUTING.md`).

## What runs on the chain

- **PETH bridge** — PETH locked on Ethereum mainnet mints wPETH 1:1 here.
- **MemeVault** — the portfolio (wPEPE / wGTA / wPEP) is locked 1:1 with mainnet.
- **DEX** — Uniswap V2-style pairs (wPETH/PDOGE, sBTC/PDOGE).
- **Staking farm** — stake wPETH, earn PDOGE.
- **Synthetic BTC** — sBTC backed by PETH reserves on mainnet.

See the [README](README.md) for contract addresses and the full architecture.

## Troubleshooting

- **"Geth only supports PoS networks"** — you're on geth 1.17+. Use 1.13.15.
- **"clique does not support shanghai fork" / PUSH0 reverts** — your genesis is wrong or your geth is too new. Use the genesis from this repo and geth 1.13.15. The chain is pre-Shanghai by design.
- **Node won't peer** — check TCP/UDP 30303 is open and use `admin.addPeer` with the enode above. If your enode shows `discport=0`, you started with `--nodiscover`; restart without it.
- **Stuck transaction ("replacement transaction underpriced")** — a low-gas-price tx is clogging your pool at that nonce. Resubmit the same nonce with a higher gas price.
- **Wrong chain / empty state** — you initialised with the wrong genesis. Wipe the datadir (`rm -rf ./pdoge-data`) and re-init with the genesis from this repo.
