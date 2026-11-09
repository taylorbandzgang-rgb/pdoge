# pBitcoin Mining — State of the Chain

pBitcoin is a mineable token that lives **only** on the PDOGE chain (chain ID **42069**). Fair launch, zero premine, fixed 21M cap, Bitcoin-style halvings. Mining is proof-of-work inside the token contract — anyone can mine.

> **Numbers below are live as of 2026-11-09 ~12:41 EST, block 50164.** They change with every mint. Refresh them anytime with `node scripts/pbitcoin-status.js` (read-only, no key needed) — it prints the same table from the chain itself.

## Live status

| | |
|---|---|
| **Contract** | `0x2D3D8Be994ee04531Bfcef9234Be26E793DF5C37` |
| **Name / symbol** | pBitcoin / ₿ (the Bitcoin glyph — this is *not* real Bitcoin, and the BTC ticker is deliberately not used) |
| **Decimals** | 8 |
| **Minted so far** | **50.0 / 21,000,000 (0.000238%)** |
| **Successful mints** | **1** |
| **Reward era** | **0 — 50 pBitcoin per mint** (halves at 10,500,000 minted, then 15,750,000, then 18,375,000…) |
| **Mining difficulty** | **131,071** hashes expected per mint |
| **Next mint, estimated** | ~7s at 18k H/s (the reference JS miner) · ~0.1s at 1 MH/s |
| **First mint** | tx `0xb1602d157b83ac9b912aa262f0fdf38c8f622b0b9ce84abc33ca2f7d07a5d15d`, block 50029 |

About that estimate: nobody knows the network hashrate, so there is no single "time to next mint." The expected work is the difficulty — 131,071 hashes — and the time is just that divided by *your* hashrate. The contract retargets toward ~10 minutes between mints, so as more miners join, difficulty climbs and each mint takes longer.

**See every mint:** the live [Mint Explorer](https://34.148.123.122.nip.io/site/mining.html) on the official site lists all mints with block, time, transaction hash, miner, nonce and solution digest — read straight from the chain, refreshing every 30 seconds.

## Mine it — one command (after setup)

You need your own PDOGE node (the public RPC rejects sends), a little PDOGE for gas, and a miner key. Full node guide: [NODE_JOINING.md](NODE_JOINING.md).

```bash
git clone https://github.com/taylorbandzgang-rgb/pdoge.git
cd pdoge
npm install
npx hardhat compile

# Mine one block, then stop. Loop without --once to keep mining.
PBITCOIN_ADDRESS=0x2D3D8Be994ee04531Bfcef9234Be26E793DF5C37 \
PDOGE_RPC_URL=http://127.0.0.1:8545 \
MINER_PRIVATE_KEY=<your key, never share it> \
node scripts/mine-pbitcoin.js --once
```

What the miner does: reads the current challenge and target from the contract, searches nonces locally until it finds one whose hash is below target, then calls `mint(nonce, digest)` on the contract. If someone else solves the challenge first, your attempt fails and the miner just moves on to the fresh challenge. The miner is `scripts/mine-pbitcoin.js` in this repo — read it before running it.

## Verify it yourself

Don't take this page's word for it. Everything above is readable from the chain with no key and no trust:

```bash
# Same numbers, straight from the contract (read-only, public RPC):
node scripts/pbitcoin-status.js

# Or raw RPC — totalSupply() is 0x18160ddd, and 50.0 pBitcoin = 5,000,000,000 base units:
curl -s -X POST https://34.148.123.122.nip.io -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x2D3D8Be994ee04531Bfcef9234Be26E793DF5C37","data":"0x18160ddd"},"latest"]}'
```

Read the contract source before trusting it: [contracts/pBitcoin.sol](contracts/pBitcoin.sol). It has no owner, no premine, no pause, no admin mint — the deployer got nothing, supply was 0 at deploy, and every token enters circulation only through `mint()`. It is **unaudited** and experimental.

## Why this is interesting

- **Fair launch.** No premine, no ICO, no team allocation. The first 50 pBitcoin were mined in the open, on-chain, like every mint after them will be.
- **Fixed 21M cap, Bitcoin-style halvings.** Reward starts at 50 per mint and halves at 10.5M, 15.75M, 18.375M… minted. When the reward rounds to zero, mining is over.
- **Mining is pure open PoW inside the contract.** No permission, no allowlist, no staking. Anyone with a CPU and a node can mine — the 0xBitcoin (EIP-918) pattern, rebuilt for this chain.
- **The chain is still early and needs independent nodes.** Today there is one validator. Outside nodes can join ([NODE_JOINING.md](NODE_JOINING.md)) and validators are voted in by existing signers. More nodes make the chain real instead of a demo.
- **Experimental, stated plainly.** This is a small PoA chain, contracts are unaudited, pBitcoin has no market price and no pool yet. Don't put in more than you can lose.

## How you can help

- **Run a full node.** Follow [NODE_JOINING.md](NODE_JOINING.md) — geth 1.13.15, the genesis file, and the bootnode are all in there. A synced node is the most useful thing you can do for the chain.
- **Mine pBitcoin and keep some.** Mine a few mints, hold them, and show the chain has miners who aren't the operator.
- **Report issues / improve the miner.** The JS miner does ~18k hashes/sec — a faster miner, a pool, or a better difficulty display are all real contributions. Open an issue or a PR.
- **Add liquidity later, if/when a pool appears.** There is no pBitcoin pool yet — there can't be one until mined supply exists. When someone seeds one, it'll be listed here.

## Links

- **Contract source:** [contracts/pBitcoin.sol](contracts/pBitcoin.sol)
- **Miner:** [scripts/mine-pbitcoin.js](scripts/mine-pbitcoin.js) · **Live status script:** [scripts/pbitcoin-status.js](scripts/pbitcoin-status.js)
- **Run a node:** [NODE_JOINING.md](NODE_JOINING.md)
- **Chain:** PDOGE, chain ID 42069, RPC https://34.148.123.122.nip.io
- **Main repo:** [README.md](README.md)
