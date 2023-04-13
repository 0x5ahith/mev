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
    address uniswapFlashPool;
    address uniswapPool;
    address sushiswapPool;
    uint24 uniswapPoolFee;
  }
  struct FlashCallbackParams {
    address tokenA;
    uint256 amountA;
    uint256 amountBOutMin;
    uint256 amountAOutMin;
    address uniswapFlashPool;
    address sushiswapPool;
    uint24 uniswapPoolFee;
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
    IUniswapV3Pool flashPool = IUniswapV3Pool(params.uniswapFlashPool);
    uint256 token0Amount = params.tokenA == flashPool.token0()
      ? params.amountA
      : 0;
    uint256 token1Amount = params.tokenA == flashPool.token1()
      ? params.amountA
      : 0;

    flashPool.flash(
      address(this),
      token0Amount,
      token1Amount,
      abi.encode(
        FlashCallbackParams({
          tokenA: params.tokenA,
          amountA: params.amountA,
          amountBOutMin: params.amountBOutMin,
          amountAOutMin: params.amountAOutMin,
          uniswapFlashPool: params.uniswapFlashPool,
          sushiswapPool: params.sushiswapPool,
          uniswapPoolFee: params.uniswapPoolFee,
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
    require(fee0 == 0 || fee1 == 0, 'Flash allowed for only one token');
    FlashCallbackParams memory params = abi.decode(data, (FlashCallbackParams));

    // Validate caller is a Uniswap pool
    IUniswapV3Pool flashPool = IUniswapV3Pool(params.uniswapFlashPool);
    address token0 = flashPool.token0();
    address token1 = flashPool.token1();
    CallbackValidation.verifyCallback(
      uniswapV3Factory,
      token0,
      token1,
      flashPool.fee()
    );

    address tokenA = params.tokenA;
    address tokenB = tokenA != token0 ? token0 : token1;

    // Swap on SushiSwap
    address[] memory path = new address[](2);
    path[0] = tokenA;
    path[1] = tokenB;

    TransferHelper.safeApprove(
      tokenA,
      address(sushiswapRouter),
      params.amountA
    );
    uint256 amountB = sushiswapRouter.swapExactTokensForTokens(
      params.amountA,
      params.amountBOutMin,
      path,
      address(this),
      block.timestamp - 1 // test this
    )[1];

    // Swap back on Uniswap
    uint256 amountAOwed = LowGasSafeMath.add(
      params.amountA,
      fee0 != 0 ? fee0 : fee1
    );
    TransferHelper.safeApprove(tokenB, address(uniswapV3Router), amountB);
    uint256 amountAOut = uniswapV3Router.exactInputSingle(
      ISwapRouter.ExactInputSingleParams({
        tokenIn: tokenB,
        tokenOut: tokenA,
        fee: params.uniswapPoolFee,
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
    if (amountAOut > amountAOwed) {
      uint256 profits = LowGasSafeMath.sub(amountAOut, amountAOwed);
      TransferHelper.safeTransfer(tokenA, params.caller, profits);
    }
  }
}
