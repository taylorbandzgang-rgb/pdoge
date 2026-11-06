// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WPETHStaking — stake wPETH, farm PDOGE.
/// @notice Synthetix StakingRewards pattern, adapted for NATIVE token rewards
///         (PDOGE is the chain's gas token, not an ERC20).
///         - Users stake wPETH, earn PDOGE pro-rata over `rewardsDuration`.
///         - Operator funds a reward round by calling notifyRewardAmount()
///           with PDOGE attached. Leftover rate rolls into the next round.
///         Demo-grade: not audited. On a private chain the PDOGE rewards have
///         no market value — this is real staking infrastructure running on
///         simulated economics until the chain/economy goes public.
contract WPETHStaking is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable wPETH;

    uint256 public rewardsDuration = 30 days;
    uint256 public periodFinish;
    uint256 public rewardRate; // PDOGE per second, 18 decimals
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsFunded(uint256 amount, uint256 duration);

    constructor(address _wPETH) Ownable(msg.sender) {
        wPETH = IERC20(_wPETH);
    }

    // --- views ---

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) return rewardPerTokenStored;
        return
            rewardPerTokenStored +
            (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalSupply);
    }

    function earned(address account) public view returns (uint256) {
        return
            ((_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) +
            rewards[account];
    }

    // --- mutative ---

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "stake: zero");
        _totalSupply += amount;
        _balances[msg.sender] += amount;
        wPETH.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0 && amount <= _balances[msg.sender], "withdraw: bad amount");
        _totalSupply -= amount;
        _balances[msg.sender] -= amount;
        wPETH.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            (bool ok, ) = msg.sender.call{value: reward}("");
            require(ok, "reward transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        this.withdraw(_balances[msg.sender]);
        this.getReward();
    }

    // --- operator ---

    /// @notice Fund (or top up) a reward round. Send PDOGE with the call.
    /// Leftover rate from an active round rolls over into the new one.
    function notifyRewardAmount() external payable onlyOwner updateReward(address(0)) {
        require(msg.value > 0, "fund: zero");
        if (block.timestamp >= periodFinish) {
            rewardRate = msg.value / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (msg.value + leftover) / rewardsDuration;
        }
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardsFunded(msg.value, rewardsDuration);
    }

    function setRewardsDuration(uint256 _duration) external onlyOwner {
        require(block.timestamp > periodFinish, "round active");
        rewardsDuration = _duration;
    }

    /// @notice Sweep native PDOGE that is NOT earmarked for rewards
    /// (e.g. accidental transfers). Cannot touch the active round's funding.
    function sweepExcessNative(address to, uint256 amount) external onlyOwner {
        uint256 earmarked = 0;
        if (block.timestamp < periodFinish) {
            earmarked = (periodFinish - block.timestamp) * rewardRate;
        }
        uint256 bal = address(this).balance;
        require(amount <= bal - earmarked, "sweep: reward funds locked");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "sweep failed");
    }

    receive() external payable {}
}
