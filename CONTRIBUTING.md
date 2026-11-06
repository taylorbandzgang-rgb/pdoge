# Contributing to PseudoDogecoin

Welcome. This is a real chain with real (small) money on it, so we keep it simple and honest.

## Ground rules

- **Never commit secrets.** No private keys, mnemonics, `.env` files, or passwords. The `.gitignore` blocks them — don't work around it. If you accidentally commit one, tell us immediately so we can rotate it.
- **Don't move other people's money.** The operator key, the vaults, and the live chain are Domenic's. Propose changes, don't run them against production.
- **Be honest about trust.** The bridge is operator-trusted and the contracts are unaudited. Don't write docs or code that hides that.

## How to contribute

1. Fork the repo and clone your fork.
2. `npm install`, then `npx hardhat compile` to make sure it builds.
3. Make your change on a branch. Keep it small and focused.
4. Open a pull request with a plain-English description of what changed and why. Link the issue if there is one.

## Good first issues

- **Review the vault.** `contracts/MemeVault.sol`, `contracts/WrappedMeme.sol`, `contracts/MemeVaultPDOGE.sol` are short. Read them, try to break them, open an issue with what you find.
- **Harden the relayer.** `scripts/relayer.js` has a known dedup weakness on restart (it once re-minted unbacked wPETH). A durable processed-event store would fix it properly.
- **DEX improvements.** `contracts/PDOGESwapFactory.sol` and `PDOGESwapPair.sol` are a minimal Uniswap V2-style pair. Fees, better routing, and a frontend are all open.
- **Docs.** If something in the README is wrong or unclear, fix it. Docs PRs are real PRs.

## Running it locally

```bash
cp .env.example .env        # fill in a throwaway operator key — local only
npm run node                # Hardhat node, chain ID 42069
node scripts/deploy-pdoge.js
```

Use throwaway keys for local testing. Never use a real operator key outside the production VM.

## Questions

Open an issue. If it's about the live chain (RPC, faucet, vault), say so in the title and include the contract address or transaction hash you're asking about.
