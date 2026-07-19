// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SimpleLending
/// @notice A basic deposit / withdraw / borrow / repay pool for USDC, EURC, and cirBTC.
///         Hackathon-stage MVP: NO liquidations yet. Borrowing is gated by a simple
///         collateral ratio calculated using manually-set reference prices (owner-set,
///         standing in for a real price oracle). Interest is simple (linear), not compounding.
///
/// IMPORTANT: This is a testnet learning project. tokenPriceUSD values are set by the
/// contract owner as a placeholder for a real oracle (e.g. Chainlink) — do not use this
/// design pattern in production / with real funds.
contract SimpleLending {
    address public owner;

    address public immutable USDC;
    address public immutable EURC;
    address public immutable CIRBTC;

    uint256 public constant DEPOSIT_APY_BPS = 500;   // 5.00% simple annual interest for depositors
    uint256 public constant BORROW_APY_BPS = 800;    // 8.00% simple annual interest for borrowers
    uint256 public constant COLLATERAL_RATIO_BPS = 15000; // 150% required collateral value
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant YEAR = 365 days;

    // Reference prices in USD, scaled by 1e6 (e.g. 1 USDC = 1_000000, 1 cirBTC = 100000_000000)
    // Set manually by the owner — placeholder for a real oracle.
    mapping(address => uint256) public tokenPriceUSD;

    struct Deposit {
        uint256 principal;
        uint256 lastUpdate;
    }

    struct Borrow {
        uint256 principal;
        uint256 lastUpdate;
    }

    // user => token => deposit info (earns interest, usable as pool liquidity)
    mapping(address => mapping(address => Deposit)) public deposits;

    // user => token => collateral amount (does NOT earn interest, backs borrowing)
    mapping(address => mapping(address => uint256)) public collateral;

    // user => token => borrow info
    mapping(address => mapping(address => Borrow)) public borrows;

    // token => total currently borrowed out (used to check available liquidity)
    mapping(address => uint256) public totalBorrowed;

    event Deposited(address indexed user, address token, uint256 amount);
    event Withdrawn(address indexed user, address token, uint256 amount, uint256 interest);
    event CollateralDeposited(address indexed user, address token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address token, uint256 amount);
    event Borrowed(address indexed user, address token, uint256 amount);
    event Repaid(address indexed user, address token, uint256 amount, uint256 interest);

    constructor(address _usdc, address _eurc, address _cirbtc) {
        owner = msg.sender;
        USDC = _usdc;
        EURC = _eurc;
        CIRBTC = _cirbtc;

        // Sensible testnet defaults — the owner can update these any time.
        tokenPriceUSD[_usdc] = 1_000000;        // $1.00
        tokenPriceUSD[_eurc] = 1_050000;        // $1.05
        tokenPriceUSD[_cirbtc] = 100000_000000; // $100,000.00 (placeholder)
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlySupported(address token) {
        require(token == USDC || token == EURC || token == CIRBTC, "Unsupported token");
        _;
    }

    /// @notice Owner can update the reference USD price (6 decimals) for a supported token.
    function setTokenPrice(address token, uint256 priceUSD) external onlyOwner onlySupported(token) {
        tokenPriceUSD[token] = priceUSD;
    }

    // ---------------------------------------------------------------------
    // Deposits (earn interest, provide borrowable liquidity)
    // ---------------------------------------------------------------------

    function deposit(address token, uint256 amount) external onlySupported(token) {
        require(amount > 0, "Amount must be > 0");
        _accrueDeposit(msg.sender, token);

        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        deposits[msg.sender][token].principal += amount;

        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external onlySupported(token) {
        _accrueDeposit(msg.sender, token);

        Deposit storage d = deposits[msg.sender][token];
        require(amount > 0 && amount <= d.principal, "Invalid amount");

        uint256 available = _availableLiquidity(token);
        require(amount <= available, "Not enough pool liquidity right now");

        d.principal -= amount;
        require(IERC20(token).transfer(msg.sender, amount), "transfer failed");

        emit Withdrawn(msg.sender, token, amount, 0);
    }

    /// @notice Withdraw all accrued interest without touching principal.
    function claimInterest(address token) external onlySupported(token) {
        uint256 interest = _pendingDepositInterest(msg.sender, token);
        require(interest > 0, "No interest accrued");

        uint256 available = _availableLiquidity(token);
        require(interest <= available, "Not enough pool liquidity right now");

        deposits[msg.sender][token].lastUpdate = block.timestamp;
        require(IERC20(token).transfer(msg.sender, interest), "transfer failed");

        emit Withdrawn(msg.sender, token, 0, interest);
    }

    // ---------------------------------------------------------------------
    // Collateral
    // ---------------------------------------------------------------------

    function depositCollateral(address token, uint256 amount) external onlySupported(token) {
        require(amount > 0, "Amount must be > 0");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        collateral[msg.sender][token] += amount;

        emit CollateralDeposited(msg.sender, token, amount);
    }

    function withdrawCollateral(address token, uint256 amount) external onlySupported(token) {
        require(amount > 0 && amount <= collateral[msg.sender][token], "Invalid amount");

        collateral[msg.sender][token] -= amount;
        require(_isCollateralSufficient(msg.sender), "Would break collateral ratio");

        require(IERC20(token).transfer(msg.sender, amount), "transfer failed");

        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    // ---------------------------------------------------------------------
    // Borrow / Repay
    // ---------------------------------------------------------------------

    function borrow(address token, uint256 amount) external onlySupported(token) {
        require(amount > 0, "Amount must be > 0");

        uint256 available = _availableLiquidity(token);
        require(amount <= available, "Not enough pool liquidity right now");

        _accrueBorrow(msg.sender, token);
        borrows[msg.sender][token].principal += amount;
        totalBorrowed[token] += amount;

        require(_isCollateralSufficient(msg.sender), "Insufficient collateral");

        require(IERC20(token).transfer(msg.sender, amount), "transfer failed");

        emit Borrowed(msg.sender, token, amount);
    }

    function repay(address token, uint256 amount) external onlySupported(token) {
        _accrueBorrow(msg.sender, token);

        Borrow storage b = borrows[msg.sender][token];
        require(amount > 0 && amount <= b.principal, "Invalid amount");

        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        b.principal -= amount;
        totalBorrowed[token] -= amount;

        emit Repaid(msg.sender, token, amount, 0);
    }

    // ---------------------------------------------------------------------
    // Internal accounting helpers
    // ---------------------------------------------------------------------

    function _accrueDeposit(address user, address token) internal {
        uint256 interest = _pendingDepositInterest(user, token);
        if (interest > 0) {
            deposits[user][token].principal += interest;
        }
        deposits[user][token].lastUpdate = block.timestamp;
    }

    function _accrueBorrow(address user, address token) internal {
        uint256 interest = _pendingBorrowInterest(user, token);
        if (interest > 0) {
            borrows[user][token].principal += interest;
            totalBorrowed[token] += interest;
        }
        borrows[user][token].lastUpdate = block.timestamp;
    }

    function _pendingDepositInterest(address user, address token) internal view returns (uint256) {
        Deposit memory d = deposits[user][token];
        if (d.principal == 0 || d.lastUpdate == 0) return 0;
        uint256 elapsed = block.timestamp - d.lastUpdate;
        return (d.principal * DEPOSIT_APY_BPS * elapsed) / (BPS_DENOMINATOR * YEAR);
    }

    function _pendingBorrowInterest(address user, address token) internal view returns (uint256) {
        Borrow memory b = borrows[user][token];
        if (b.principal == 0 || b.lastUpdate == 0) return 0;
        uint256 elapsed = block.timestamp - b.lastUpdate;
        return (b.principal * BORROW_APY_BPS * elapsed) / (BPS_DENOMINATOR * YEAR);
    }

    /// @notice Total value (USD, 6 decimals) of a user's collateral across all supported tokens.
    function _collateralValueUSD(address user) internal view returns (uint256 total) {
        total += (collateral[user][USDC] * tokenPriceUSD[USDC]) / 1e6;
        total += (collateral[user][EURC] * tokenPriceUSD[EURC]) / 1e6;
        total += (collateral[user][CIRBTC] * tokenPriceUSD[CIRBTC]) / 1e6;
    }

    /// @notice Total value (USD, 6 decimals) of a user's outstanding borrows, including accrued interest.
    function _borrowValueUSD(address user) internal view returns (uint256 total) {
        total += ((borrows[user][USDC].principal + _pendingBorrowInterest(user, USDC)) * tokenPriceUSD[USDC]) / 1e6;
        total += ((borrows[user][EURC].principal + _pendingBorrowInterest(user, EURC)) * tokenPriceUSD[EURC]) / 1e6;
        total += ((borrows[user][CIRBTC].principal + _pendingBorrowInterest(user, CIRBTC)) * tokenPriceUSD[CIRBTC]) / 1e6;
    }

    function _isCollateralSufficient(address user) internal view returns (bool) {
        uint256 borrowValue = _borrowValueUSD(user);
        if (borrowValue == 0) return true;
        uint256 requiredCollateral = (borrowValue * COLLATERAL_RATIO_BPS) / BPS_DENOMINATOR;
        return _collateralValueUSD(user) >= requiredCollateral;
    }

    function _availableLiquidity(address token) internal view returns (uint256) {
        uint256 bal = _tokenBalance(token);
        return bal;
    }

    function _tokenBalance(address token) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(ok, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    // ---------------------------------------------------------------------
    // Read-only views for the frontend
    // ---------------------------------------------------------------------

    function getDepositBalance(address user, address token) external view returns (uint256 principal, uint256 pendingInterest) {
        principal = deposits[user][token].principal;
        pendingInterest = _pendingDepositInterest(user, token);
    }

    function getBorrowBalance(address user, address token) external view returns (uint256 principal, uint256 pendingInterest) {
        principal = borrows[user][token].principal;
        pendingInterest = _pendingBorrowInterest(user, token);
    }

    function getCollateralValueUSD(address user) external view returns (uint256) {
        return _collateralValueUSD(user);
    }

    function getBorrowValueUSD(address user) external view returns (uint256) {
        return _borrowValueUSD(user);
    }

    function getMaxBorrowableUSD(address user) external view returns (uint256) {
        uint256 collateralValue = _collateralValueUSD(user);
        uint256 borrowValue = _borrowValueUSD(user);
        uint256 maxTotalBorrowUSD = (collateralValue * BPS_DENOMINATOR) / COLLATERAL_RATIO_BPS;
        if (maxTotalBorrowUSD <= borrowValue) return 0;
        return maxTotalBorrowUSD - borrowValue;
    }
}
