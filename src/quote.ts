import { Token } from "@uniswap/sdk-core";

import { USDC_TOKEN, WETH_TOKEN } from "./tokens";
import { TokenArbitrage } from "./TokenArbitrage";
import { toReadableAmount } from "./utils";

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

  // gas costs

  console.log("====> Best arb");
  console.log(
    "Profit:",
    toReadableAmount(bestArb.profit, bestArb.flashToken.decimals)
  );

  // Do arbitrage
}

async function main(): Promise<void> {
  // Iterate through all token pairs

  checkAndDoIfArbExistsForTokens(WETH_TOKEN, USDC_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
