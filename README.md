# PseudoDogecoin (PDOGE)

Domenic's own EVM blockchain. Chain ID **42069**. Native gas token **PDOGE**. Live, bridged to Ethereum mainnet, and open source.

## The headline: the MemeVault

The portfolio lives in a vault, not a wallet.

- **Mainnet MemeVault** (`0x83A6519B1E3f22cd125bE19301B00a6020C8012d`) is a generic multi-token vault: `lock()` is permissionless for any ERC20, `release()` is operator-only. Right now it secures the trading portfolio: **699,459 PEPE, 1,985,131 GTA, and 300.1B PEP**.
- **On the PDOGE chain**, each locked token has a 1:1 wrapped twin — wPEPE, wGTA, wPEP — minted straight into **MemeVaultPDOGE** (`0x5F00bB72952Ade2905AfC163d488eF29E2b4dA1E`). Same amounts, same backing, verifiable on-chain.
- **The full loop is proven:** lock → mint → burn → release. We locked 1,000 PEPE, minted its wrapped twin, burned it, and released the real PEPE back — both directions work.
- **Deliberately simple:** the vault uses a manual-mint design, no relayer changes. The PETH bridge relayer is untouched, so the vault can't break the bridge. The exit is one script: `scripts/meme-vault-exit.js` (burn wrapped on PDOGE, release on mainnet, then sell).

That's the part we're proudest of. The rest of the chain is below.

## What this is

- **A live, public EVM chain** (geth 1.13 Clique, chain 42069). Anyone can run a node and join — see [NODE_JOINING.md](NODE_JOINING.md). The operator sets the gas price, so a transfer costs a fraction of a cent by decree. That's the whole "cheap gas" story: it's our network, our rules.
- **PETH** is an ERC20 on Ethereum mainnet, bridged in as **wPETH** 1:1 when PETH locks on mainnet. Same PETH, now usable on the cheap chain.
- **A Uniswap V2-style DEX** (factory + pairs), a **staking farm** (wPETH → PDOGE rewards), **synthetic BTC** backed by locked PETH, a **wPETH faucet** (play Dollar Dash, score 400+, claim 1 wPETH), and the vault above.

It is NOT a public L2 — no Ethereum security. It's a small PoA chain with a single validator today; outside nodes can join and validators are voted in by existing signers (see [NODE_JOINING.md](NODE_JOINING.md)). It's a sandbox chain, and the scaffold to build on. We're honest about that.

## Architecture

```
Ethereum mainnet                          PDOGE chain (42069)
┌──────────────────────┐                  ┌──────────────────────────┐
│ PETH (ERC20)         │                  │ PDOGE (native gas)     │
│ PETHVault (lock)     │ ── relayer ──▶   │ WrappedPETH (wPETH)    │
│ PETHReserveVault     │                  │ PDOGEBridge            │
│ PDOGEToken (ERC20)   │                  │ DEX (Factory + Pairs)  │
│ MemeVault (lock)     │ ── manual ──▶    │ WPETHStaking (farm)    │
│ Uniswap V2 pools     │                  │ SyntheticBTC (sBTC)    │
└──────────────────────┘                  │ MemeVaultPDOGE + wMeme │
                                          └──────────────────────────┘
```

- **Bridge:** lock PETH in the mainnet vault → relayer mints wPETH 1:1 on PDOGE. Burn wPETH → relayer releases PETH. Operator-trusted (stated honestly, not hidden).
- **sBTC:** 21 synthetic BTC, backed pro-rata by ~100,000 PETH locked in the reserve vault. Redeem sBTC → PETH released on mainnet.
- **Farm:** stake wPETH, earn PDOGE. 30,000 PDOGE over 30 days, 1,000/day.
- **Faucet:** play Dollar Dash, score 400+, claim 1 wPETH (1 claim/address/day, 50/day global cap).

## Deployed contracts (live)

### Ethereum mainnet
| Contract | Address |
|---|---|
| PETH (PseudoETH) | `0x34fDfEf7F661e95B10F821173763cd4C0d1974ca` |
| PETHVault | `0x079dF29BC26502b9476b4a044F7cb61a4e8CC7Be` |
| PETHReserveVault | `0xfFccd994372FC9b75beE0428AE36E5D775923B9F` |
| PDOGEToken | `0x31Bd41c01434C0fa603747FCC6B97a237CA70c9d` |
| **MemeVault** | `0x83A6519B1E3f22cd125bE19301B00a6020C8012d` |
| PETH/ETH pool (Uniswap V2) | `0x93333653a1E61C9F3C573165aa8f9C394d457E3f` |
| PDOGE/ETH pool (Uniswap V2) | `0x95B3c872A8eAacE11f9CFFFb9b4a111a2e7A644d` |

### PDOGE chain (42069)
| Contract | Address |
|---|---|
| WrappedPETH (wPETH) | `0x36ae241Ed75b5fD2EaBbB5F9033d94663a4A9D37` |
| PDOGEToken | `0x40823475102861Db927bbA4FCf735aF0fCC3c0a8` |
| SyntheticBTC (sBTC) | `0x783608eD49B6D0Fa9C2D14adBC58D212aE1928E0` |
| PDOGEBridge | `0x1b472f94677F28C8B5b53E2594Af92e53D7963EA` |
| WPETHStaking (farm) | `0x1265661d0C80dAFC7db99c0EBDFB59c5f172E274` |
| SBTCRedeem | `0x0A81CD78f358C248298249332fdc9Eb8250b7a44` |
| wPEPE | `0xB625D91124dEdf107DDcd001f3A2E9BB821C35e1` |
| wGTA | `0x69a56929cCDbdc47Dc5753c2099Fc7db5a4Ce371` |
| wPEP | `0xbD0D56334116c91cf7e49F5f337c0fB2bcFAaBF9` |
| **MemeVaultPDOGE** | `0x5F00bB72952Ade2905AfC163d488eF29E2b4dA1E` |
| wPETH/PDOGE pair | `0xEae78C6eb11589E419F321fa6589f6FA9833A79a` |
| sBTC/PDOGE pair | `0xD512F0Ccd3bB1f27aeed520EE45888EB198Cb624` |

**RPC:** `https://34.148.123.122.nip.io` (chain 42069, symbol PDOGE). Add it to MetaMask as a custom network.

## Quick start

```bash
git clone https://github.com/<you>/pdoge.git
cd pdoge
npm install
npx hardhat compile

# Your own chain, locally:
cp .env.example .env        # fill in an operator key — NEVER commit .env
npm run node                # Hardhat node on port 8546, chain ID 42069
node scripts/deploy-pdoge.js
```

Deploy scripts live in `scripts/`, contracts in `contracts/`. The relayer (`scripts/relayer.js`), the RPC proxy (`scripts/rpc-proxy.js`), the faucet server (`scripts/wpeth-faucet-server.js`), and the systemd units (`systemd/`) are all here too — that's the whole production setup, not just the contracts.

## Run your own node

The chain is public and multi-node — anyone can join. Full guide: **[NODE_JOINING.md](NODE_JOINING.md)**.

- **Geth 1.13.15 exactly** (1.17+ dropped Clique)
- **Genesis:** `genesis.json` in this repo, or https://34.148.123.122.nip.io/site/genesis.json (md5 `041c85e8fc1015d52b4a952abf1a2c5d`)
- **Bootnode:** `enode://ba923083b792a691989c387fdcaa94dce24f9df349cbddf6c8d21011295426457ceb390aeb6bd527a344ee72cf49e40df4cddfaeba2fc66f3a0a0b6b27fff56f@34.148.123.122:30303`
- **Chain ID:** 42069, **gas:** PDOGE (PETH can't pay gas — get starter PDOGE by opening a GitHub issue with your address)

## Contributing

We want nerds. See [CONTRIBUTING.md](CONTRIBUTING.md). Good places to start:

- **The vault:** review `MemeVault.sol` / `WrappedMeme.sol` / `MemeVaultPDOGE.sol`. Small, readable, and the part we brag about — find a hole and we'll fix it in the open.
- **The relayer:** `scripts/relayer.js` is the bridge's beating heart. It has a known dedup weakness on restart — help us harden it.
- **The DEX:** `PDOGESwapFactory.sol` / `PDOGESwapPair.sol` are a minimal Uniswap V2-style pair. Fees, routing, and a frontend are all open.
- **The faucet game:** Dollar Dash is a playable web game that pays wPETH. New games, new rewards, better anti-sybil — all welcome.

Open an issue first for big changes. Small fixes, just send a PR.

## Security & honesty

- This is a **small PoA chain**, not a public L2. It runs geth Clique with a single validator today; outside nodes can join and validators are voted in by existing signers (see [NODE_JOINING.md](NODE_JOINING.md)). It does not have Ethereum-level security.
- The **bridge is operator-trusted**: the vault code is trustless, but releases run through an operator key. We say that plainly.
- Contracts are **unaudited**. Don't put in more than you can lose.
- The vault code is small and readable — read it before trusting it.

## Links

- **RPC:** https://34.148.123.122.nip.io
- **Genesis:** https://34.148.123.122.nip.io/site/genesis.json (also in this repo as `genesis.json`)
- **Bootnode:** `enode://ba923083b792a691989c387fdcaa94dce24f9df349cbddf6c8d21011295426457ceb390aeb6bd527a344ee72cf49e40df4cddfaeba2fc66f3a0a0b6b27fff56f@34.148.123.122:30303`
- **Run your own node:** [NODE_JOINING.md](NODE_JOINING.md)
- **pBitcoin mining:** [MINING.md](MINING.md) — live stats, the miner, and how to verify the contract yourself
- **Official site:** https://34.148.123.122.nip.io/site/
- **Dollar Dash (wPETH faucet game):** https://34.148.123.122.nip.io/dollar-dash/
- **PETH on Uniswap:** PETH/ETH pool `0x93333653a1E61C9F3C573165aa8f9C394d457E3f`
- **PDOGE on Uniswap:** PDOGE/ETH pool `0x95B3c872A8eAacE11f9CFFFb9b4a111a2e7A644d`

MIT licensed. Built by Domenic (Dbowl) and friends.
