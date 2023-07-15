import { Token } from "@uniswap/sdk-core";

import { USDC_TOKEN, WETH_TOKEN } from "./tokens";
import { TokenArbitrage } from "./TokenArbitrage";
import { toReadableAmount } from "./utils";
import { ethers } from "hardhat";
import { FLASHARB } from "./constants";

async function checkAndDoIfArbExistsForTokens(tokenA: Token, tokenB: Token) {
  const arb = new TokenArbitrage(tokenA, tokenB);

  const pools = await arb.getPools();
  if (pools.length < 3) {
    throw new Error(
      `Need at least 3 ${tokenA.symbol}-${tokenB.symbol} pools to do flash arbitrage`
    );
  }

  const bestArb = await arb.findMaxProfitableArbFromPools(pools);
  if (bestArb === undefined) {
    console.log("No profitable arbitrages");
    return;
  }

  const flashArb = await ethers.getContractAt("FlashArb", FLASHARB);
  const arbParams = {
    flashToken: bestArb.flashToken.address,
    otherToken:
      bestArb.flashToken.address == tokenA.address
        ? tokenB.address
        : tokenA.address,
    flashPoolFee: await bestArb.pools.flashPool.fee(),
    flashAmount: bestArb.flashAmount,
    firstSwapPoolFee: await bestArb.pools.firstSwapPool.fee(),
    firstSwapOutMin: bestArb.firstSwapOutMin,
    secondSwapPoolFee: await bestArb.pools.secondSwapPool.fee(),
    secondSwapOutMin: bestArb.secondSwapOutMin,
  };

  // gas costs
  const gas = await flashArb.estimateGas.initArb(arbParams);
  const gasPrice = await ethers.provider.getGasPrice(); // in terms of Wei
  // TODO: Return if arbitrage is not profitable given gas cost

  await flashArb.initArb(arbParams);

  console.log("====> Best arb");
  console.log(
    "Profit:",
    toReadableAmount(bestArb.profit, bestArb.flashToken.decimals)
  ); // include gas costs in profit calculation
}

async function main(): Promise<void> {
  checkAndDoIfArbExistsForTokens(WETH_TOKEN, USDC_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
