// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title MultiPoolSwap
/// @notice A constant-product AMM supporting three tokens (USDC, EURC, cirBTC)
///         across three independent liquidity pools: USDC-EURC, USDC-cirBTC, EURC-cirBTC.
///         0.3% swap fee, same mechanics as a standard Uniswap V2 style pool, just
///         generalized to any pair among the three supported tokens.
contract MultiPoolSwap {
    address public immutable USDC;
    address public immutable EURC;
    address public immutable CIRBTC;

    // reserves[tokenA][tokenB] = amount of tokenA held in the tokenA/tokenB pool
    mapping(address => mapping(address => uint256)) public reserves;

    event LiquidityAdded(address indexed provider, address tokenA, address tokenB, uint256 amountA, uint256 amountB);
    event Swap(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address _usdc, address _eurc, address _cirbtc) {
        USDC = _usdc;
        EURC = _eurc;
        CIRBTC = _cirbtc;
    }

    modifier onlySupported(address token) {
        require(token == USDC || token == EURC || token == CIRBTC, "Unsupported token");
        _;
    }

    /// @notice Add liquidity to the tokenA/tokenB pool. Both amounts are pulled from the caller.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external onlySupported(tokenA) onlySupported(tokenB) {
        require(tokenA != tokenB, "Tokens must differ");
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");

        require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountA), "transferFrom A failed");
        require(IERC20(tokenB).transferFrom(msg.sender, address(this), amountB), "transferFrom B failed");

        reserves[tokenA][tokenB] += amountA;
        reserves[tokenB][tokenA] += amountB;

        emit LiquidityAdded(msg.sender, tokenA, tokenB, amountA, amountB);
    }

    /// @notice Swap an exact amount of tokenIn for tokenOut, using the tokenIn/tokenOut pool.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external onlySupported(tokenIn) onlySupported(tokenOut) returns (uint256 amountOut) {
        require(tokenIn != tokenOut, "Tokens must differ");
        require(amountIn > 0, "amountIn must be > 0");

        uint256 reserveIn = reserves[tokenIn][tokenOut];
        uint256 reserveOut = reserves[tokenOut][tokenIn];
        require(reserveIn > 0 && reserveOut > 0, "Pool has no liquidity");

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut > 0 && amountOut < reserveOut, "Insufficient output / liquidity");

        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "transferFrom failed");

        reserves[tokenIn][tokenOut] += amountIn;
        reserves[tokenOut][tokenIn] -= amountOut;

        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "transfer out failed");

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice View-only helper to preview a swap's output. 0.3% fee baked in.
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        return numerator / denominator;
    }

    /// @notice Convenience view to read both sides of a pool at once.
    function getReserves(address tokenA, address tokenB) external view returns (uint256 reserveA, uint256 reserveB) {
        reserveA = reserves[tokenA][tokenB];
        reserveB = reserves[tokenB][tokenA];
    }
}
