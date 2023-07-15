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
import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';

import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';

import '@sushiswap/sushiswap/contracts/interfaces/IUniswapV2Callee.sol';

contract FlashArb is IUniswapV3FlashCallback {
  ISwapRouter public immutable uniswapRouter;
  IUniswapV2Router02 public immutable sushiswapRouter;
  address public immutable uniswapFactory;

  struct ArbParams {
    address flashToken;
    address otherToken;
    uint24 flashPoolFee;
    uint256 flashAmount; // TODO: can i reduce int size?
    uint24 firstSwapPoolFee;
    uint256 firstSwapOutMin;
    uint24 secondSwapPoolFee;
    uint256 secondSwapOutMin;
  }
  struct FlashCallbackParams {
    address flashToken;
    address otherToken;
    PoolAddress.PoolKey flashPoolKey;
    uint256 flashAmount;
    uint24 firstSwapPoolFee;
    uint256 firstSwapOutMin;
    uint24 secondSwapPoolFee;
    uint256 secondSwapOutMin;
    address caller;
  }

  constructor(
    address uniswapRouter_,
    address sushiswapRouter_,
    address uniswapFactory_
  ) {
    uniswapRouter = ISwapRouter(uniswapRouter_);
    sushiswapRouter = IUniswapV2Router02(sushiswapRouter_);
    uniswapFactory = uniswapFactory_;
  }

  function initArb(ArbParams calldata params) external {
    PoolAddress.PoolKey memory flashPoolKey = PoolAddress.getPoolKey(
      params.flashToken,
      params.otherToken,
      params.flashPoolFee
    );
    address flashPoolAddress = PoolAddress.computeAddress(
      uniswapFactory,
      flashPoolKey
    );

    IUniswapV3Pool(flashPoolAddress).flash(
      address(this),
      params.flashAmount,
      0,
      abi.encode(
        FlashCallbackParams({
          flashToken: params.flashToken,
          otherToken: params.otherToken,
          flashPoolKey: flashPoolKey,
          flashAmount: params.flashAmount,
          firstSwapPoolFee: params.firstSwapPoolFee,
          firstSwapOutMin: params.firstSwapOutMin,
          secondSwapPoolFee: params.secondSwapPoolFee,
          secondSwapOutMin: params.secondSwapOutMin,
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
    require(fee1 == 0, 'Flash allowed for only one token');
    FlashCallbackParams memory params = abi.decode(data, (FlashCallbackParams));

    // Validate caller is a Uniswap pool
    CallbackValidation.verifyCallback(uniswapFactory, params.flashPoolKey);

    address flashToken = params.flashToken;
    address otherToken = params.otherToken;

    // First swap
    uint256 firstSwapAmountOut;
    if (params.firstSwapPoolFee == 30) {
      firstSwapAmountOut = _makeSushiswap(
        flashToken,
        otherToken,
        params.flashAmount,
        params.firstSwapOutMin
      );
    } else {
      firstSwapAmountOut = _makeUniswap(
        flashToken,
        otherToken,
        params.firstSwapPoolFee,
        params.flashAmount,
        params.firstSwapOutMin
      );
    }

    // Second swap
    uint256 flashAmountOwed = LowGasSafeMath.add(params.flashAmount, fee0);
    uint256 secondSwapMinAmountOut = params.secondSwapOutMin > flashAmountOwed
      ? params.secondSwapOutMin
      : flashAmountOwed;

    uint256 secondSwapAmountOut;
    if (params.secondSwapPoolFee == 30) {
      secondSwapAmountOut = _makeSushiswap(
        otherToken,
        flashToken,
        firstSwapAmountOut,
        secondSwapMinAmountOut
      );
    } else {
      secondSwapAmountOut = _makeUniswap(
        otherToken,
        flashToken,
        params.secondSwapPoolFee,
        firstSwapAmountOut,
        secondSwapMinAmountOut
      );
    }

    // Return flash loan
    TransferHelper.safeTransfer(flashToken, msg.sender, flashAmountOwed);

    // Pay out profits
    if (secondSwapAmountOut > flashAmountOwed) {
      uint256 profits = LowGasSafeMath.sub(
        secondSwapAmountOut,
        flashAmountOwed
      );
      TransferHelper.safeTransfer(flashToken, params.caller, profits);
    }
  }

  function _makeSushiswap(
    address fromToken,
    address toToken,
    uint256 amountIn,
    uint256 minAmountOut
  ) internal returns (uint256 amountOut) {
    TransferHelper.safeApprove(fromToken, address(sushiswapRouter), amountIn);

    address[] memory path = new address[](2);
    path[0] = fromToken;
    path[1] = toToken;

    amountOut = sushiswapRouter.swapExactTokensForTokens(
      amountIn,
      minAmountOut,
      path,
      address(this),
      block.timestamp + 1
    )[1];
  }

  function _makeUniswap(
    address fromToken,
    address toToken,
    uint24 fee,
    uint256 amountIn,
    uint256 minAmountOut
  ) internal returns (uint256 amountOut) {
    TransferHelper.safeApprove(fromToken, address(uniswapRouter), amountIn);
    amountOut = uniswapRouter.exactInputSingle(
      ISwapRouter.ExactInputSingleParams({
        tokenIn: fromToken,
        tokenOut: toToken,
        fee: fee,
        recipient: address(this),
        deadline: block.timestamp + 1,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0
      })
    );
  }
}
