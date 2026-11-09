// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title pBitcoin — a mineable token on the PDOGE chain (EIP-918 / 0xBitcoin pattern).
/// @notice Spec:
///  - Name "pBitcoin", symbol "₿" (the Bitcoin glyph, NOT the BTC ticker —
///    this is not real Bitcoin and must never be passed off as such).
///  - Decimals 8, like Bitcoin / 0xBTC.
///  - Max supply 21,000,000 tokens (21,000,000 * 10^8 base units). Minting
///    stops dead at the cap.
///  - Mining: public mint(nonce, challengeDigest). The digest must equal
///    keccak256(challengeNumber, msg.sender, nonce) and be below miningTarget.
///    A successful mint pays the current reward to the miner, sets a fresh
///    challengeNumber, and adjusts the target toward a 10-minute block time.
///  - Reward rule: initial reward 50 tokens. The reward halves each time the
///    cumulative minted supply crosses a halving threshold. Thresholds are at
///    10,500,000, then 15,750,000, then 18,375,000 tokens minted, and so on —
///    i.e. era e covers minted in [MAX*(1 - 1/2^(e+1)) ... ) and the reward in
///    era e is INITIAL_REWARD / 2^e. Exactly the 0xBTC pattern: each era
///    mints half as many new tokens as the one before, so total minting
///    converges on (but, with integer base units, never exceeds) the cap.
///    Once the reward would round to 0 base units (era 33), minting is over
///    and mint() reverts.
///  - Cap rule: a mint that would push tokensMinted past MAX_SUPPLY reverts
///    ("pBitcoin: cap exceeded"). By the reward math this is a safety
///    invariant — the reward in any era is far smaller than the supply
///    remaining to the cap — but it is enforced on every mint.
///  - No owner, no premine, no ICO, no owner-only mint, no pause, no admin.
///    The deployer gets nothing special; supply is zero at deploy and every
///    token must be mined.
///  - The PDOGE chain itself is Clique PoA, so this is NOT consensus
///    proof-of-work. Mining here is proof-of-work inside the token contract:
///    miners burn CPU searching for a nonce whose digest is below target.
///  - Paris EVM only (no PUSH0): the PDOGE chain is pre-Shanghai geth 1.13.
///    Demo-grade: not audited.
contract pBitcoin is ERC20 {
    /// @notice Max supply in base units: 21,000,000 tokens * 10^8.
    uint256 public constant MAX_SUPPLY = 2_100_000_000_000_000;

    /// @notice First-era mining reward in base units: 50 tokens * 10^8.
    uint256 public constant INITIAL_REWARD = 5_000_000_000;

    /// @notice Target time between successful mints, in seconds (10 minutes).
    uint256 public constant TARGET_BLOCK_TIME = 600;

    /// @notice Starting mining target. Difficulty = 2**256 / target, so the
    ///  initial target 2**240 means ~65,536 hashes expected per mint.
    uint256 public constant INITIAL_TARGET = 1 << 240;

    /// @notice Current PoW challenge. Changes on every successful mint.
    bytes32 public challengeNumber;

    /// @notice Current mining target: a mint digest must be below this.
    uint256 public miningTarget;

    /// @notice Total base units minted so far (also == totalSupply, since
    ///  tokens only ever enter circulation via mint()).
    uint256 public tokensMinted;

    /// @notice Timestamp of the last successful mint (difficulty adjustment).
    uint256 public lastMintTime;

    /// @notice Emitted on every successful mint.
    event Mint(
        address indexed miner,
        uint256 reward,
        bytes32 indexed challengeNumber,
        uint256 miningTarget
    );

    constructor() ERC20("pBitcoin", unicode"₿") {
        challengeNumber = block.number > 0
            ? blockhash(block.number - 1)
            : keccak256(abi.encodePacked(block.timestamp, address(this)));
        miningTarget = INITIAL_TARGET;
        lastMintTime = block.timestamp;
    }

    /// @notice 8 decimals, like Bitcoin / 0xBTC.
    function decimals() public pure override returns (uint8) {
        return 8;
    }

    /// @notice Max supply in base units.
    function maxSupply() public pure returns (uint256) {
        return MAX_SUPPLY;
    }

    /// @notice Current PoW challenge.
    function getChallengeNumber() public view returns (bytes32) {
        return challengeNumber;
    }

    /// @notice Current mining target.
    function getMiningTarget() public view returns (uint256) {
        return miningTarget;
    }

    /// @notice Current mining difficulty = 2**256 / miningTarget, i.e. the
    ///  expected number of hashes to find a valid solution.
    function getMiningDifficulty() public view returns (uint256) {
        return type(uint256).max / miningTarget;
    }

    /// @notice Reward (base units) the next successful mint will pay.
    function getMiningReward() public view returns (uint256) {
        return _rewardFor(tokensMinted);
    }

    /// @notice Halving era for a given cumulative minted amount (base units).
    ///  Era 0 while minted < 10,500,000 tokens, era 1 while < 15,750,000,
    ///  era 2 while < 18,375,000, and so on.
    function eraFor(uint256 minted) public pure returns (uint256) {
        return _eraFor(minted);
    }

    /// @notice Reward (base units) that would be paid when cumulative minted
    ///  supply is `minted`. Pure, so the cap/era math can be checked without
    ///  mining out the whole supply.
    function rewardFor(uint256 minted) public pure returns (uint256) {
        return _rewardFor(minted);
    }

    function _eraFor(uint256 minted) internal pure returns (uint256) {
        uint256 era = 0;
        uint256 threshold = MAX_SUPPLY / 2; // 10,500,000 tokens
        while (minted >= threshold) {
            era += 1;
            uint256 increment = MAX_SUPPLY >> (era + 1);
            if (increment == 0) break;
            threshold += increment;
            if (era >= 63) break;
        }
        return era;
    }

    function _rewardFor(uint256 minted) internal pure returns (uint256) {
        uint256 era = _eraFor(minted);
        // INITIAL_REWARD is 5e9 base units; >> 33 is 0, so mining ends at era 33.
        if (era >= 33) return 0;
        return INITIAL_REWARD >> era;
    }

    /// @notice Mine pBitcoin. Submit a nonce whose digest
    ///  keccak256(challengeNumber, msg.sender, nonce) is below miningTarget.
    ///  Pays the current reward to msg.sender. Reverts on a stale/wrong
    ///  digest (covers replays: the challenge changes on every mint), on a
    ///  digest above target, when the reward has rounded to zero, or if the
    ///  mint would exceed MAX_SUPPLY.
    function mint(uint256 nonce, bytes32 challengeDigest) external returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked(challengeNumber, msg.sender, nonce));
        require(digest == challengeDigest, "pBitcoin: digest mismatch");
        require(uint256(digest) < miningTarget, "pBitcoin: digest above target");

        uint256 reward = _rewardFor(tokensMinted);
        require(reward > 0, "pBitcoin: mining over");
        require(tokensMinted + reward <= MAX_SUPPLY, "pBitcoin: cap exceeded");

        tokensMinted += reward;
        _mint(msg.sender, reward);

        // Fresh challenge for the next mint. Mixed from the previous block
        // hash AND this mint's miner/nonce, so the challenge changes on
        // every mint — even two mints in the same block — and a spent
        // nonce/challenge can never be replayed.
        challengeNumber = keccak256(
            abi.encodePacked(blockhash(block.number - 1), msg.sender, nonce)
        );

        // Difficulty adjustment toward the 10-minute target block time.
        // newTarget = target * elapsed / 600, clamped to a 2x move per mint
        // so one fast (or slow) mint cannot swing difficulty wildly. Fast
        // mints (< 600s) shrink the target (harder); slow mints grow it.
        uint256 elapsed = block.timestamp - lastMintTime;
        lastMintTime = block.timestamp;
        if (elapsed > 0) {
            uint256 newTarget = (miningTarget * elapsed) / TARGET_BLOCK_TIME;
            uint256 minTarget = miningTarget / 2;
            uint256 maxTarget = miningTarget * 2;
            if (newTarget < minTarget) newTarget = minTarget;
            if (newTarget > maxTarget) newTarget = maxTarget;
            if (newTarget == 0) newTarget = 1;
            miningTarget = newTarget;
        }

        emit Mint(msg.sender, reward, challengeNumber, miningTarget);
        return true;
    }
}
