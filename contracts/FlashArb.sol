// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;
pragma abicoder v2;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';

import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import '@uniswap/v3-periphery/contracts/libraries/CallbackValidation.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';

import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';

import '@sushiswap/sushiswap/contracts/interfaces/IUniswapV2Callee.sol';

contract SushiArb is IUniswapV3FlashCallback {
  ISwapRouter public immutable uniswapV3Router;
  IUniswapV2Router02 public immutable sushiswapRouter;
  address public immutable uniswapV3Factory;

  struct ArbParams {
    address tokenA;
    uint256 amountA; // TODO: can i reduce int size?
    uint256 amountBOutMin;
    uint256 amountAOutMin;
    address uniswapPool;
    address sushiswapPool;
  }
  struct FlashCallbackParams {
    address tokenA;
    uint256 amountA;
    uint256 amountBOutMin;
    uint256 amountAOutMin;
    address uniswapPool;
    address sushiswapPool;
    address caller;
  }

  constructor(
    ISwapRouter _uniswapV3Router,
    IUniswapV2Router02 _sushiswapRouter,
    address _uniswapV3Factory
  ) {
    // how to pass contract as param?
    uniswapV3Router = _uniswapV3Router;
    sushiswapRouter = _sushiswapRouter;
    uniswapV3Factory = _uniswapV3Factory;
  }

  function initArb(ArbParams calldata params) external {
    IUniswapV3Pool pool = IUniswapV3Pool(params.uniswapPool);

    uint256 token0Amount = params.tokenA == pool.token0() ? params.amountA : 0;
    uint256 token1Amount = params.tokenA == pool.token1() ? params.amountA : 0;

    pool.flash(
      address(this),
      token0Amount,
      token1Amount,
      abi.encode(
        FlashCallbackParams({
          tokenA: params.tokenA,
          amountA: params.amountA,
          amountBOutMin: params.amountBOutMin,
          amountAOutMin: params.amountAOutMin,
          uniswapPool: params.uniswapPool,
          sushiswapPool: params.sushiswapPool,
          caller: msg.sender
        })
      )
    );
  }

  function uniswapV3FlashCallback(
    uint256 fee0,
    uint256 fee1,
    bytes calldata data
  ) external override {
    FlashCallbackParams memory params = abi.decode(data, (FlashCallbackParams));

    // Validate caller is a Uniswap pool
    IUniswapV3Pool pool = IUniswapV3Pool(params.uniswapPool);
    address token0 = pool.token0();
    address token1 = pool.token1();
    uint24 uniswapFee = pool.fee();
    CallbackValidation.verifyCallback(
      uniswapV3Factory,
      token0,
      token1,
      uniswapFee
    );

    address tokenA = params.tokenA;
    address tokenB = tokenA != token0 ? token0 : token1;
    address[] memory path = new address[](2);
    path[0] = tokenA;
    path[1] = tokenB;

    // Swap on SushiSwap
    uint256 amountA = params.amountA;
    TransferHelper.safeApprove(tokenA, address(sushiswapRouter), amountA);
    uint256 amountB = sushiswapRouter.swapExactTokensForTokens(
      amountA,
      params.amountBOutMin,
      path,
      address(this),
      block.timestamp - 1 // test this
    )[1];

    // Swap back on Uniswap
    uint256 amountAOwed = LowGasSafeMath.add(
      LowGasSafeMath.add(params.amountA, fee0),
      fee1
    );
    TransferHelper.safeApprove(tokenB, address(uniswapV3Router), amountB);
    amountA = uniswapV3Router.exactInputSingle(
      ISwapRouter.ExactInputSingleParams({
        tokenIn: tokenB,
        tokenOut: tokenA,
        fee: uniswapFee,
        recipient: address(this),
        deadline: block.timestamp + 1,
        amountIn: amountB,
        amountOutMinimum: params.amountAOutMin > amountAOwed
          ? params.amountAOutMin
          : amountAOwed,
        sqrtPriceLimitX96: 0 // TODO: experiment with this
      })
    );

    // Return flash loan
    TransferHelper.safeTransfer(tokenA, msg.sender, amountAOwed);

    // Pay out profits
    if (amountA > amountAOwed) {
      uint256 profits = LowGasSafeMath.sub(amountA, amountAOwed);
      TransferHelper.safeTransfer(tokenA, params.caller, profits);
    }
  }
}
