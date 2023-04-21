import { Token } from "@uniswap/sdk-core";

import { USDC_TOKEN, WETH_TOKEN } from "./constants";
import { TokenArbitrage } from "./TokenArbitrage";

const SUSHISWAP_FEE = 30; // to distinguish from Uniswap's 3000 fee in smart contract even though both are 0.3%
const SLIPPAGE = 0.01;

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
    return;
  }

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
