import { Token } from "@uniswap/sdk-core";
import Quoter from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";

import { QUOTER_ADDRESS, USDC_TOKEN, WETH_TOKEN } from "./constants";
import {
  Pool,
  V2Pool,
  V3Pool,
  permuteAllArbs,
  Arb,
  ArbSetup,
  getPools,
  getPrice,
  provider,
  priceToSqrtPriceX96,
} from "./utils";
import { ethers, network } from "hardhat";

const SUSHISWAP_FEE = 30; // to distinguish from Uniswap's 3000 fee in smart contract even though both are 0.3%
const SLIPPAGE = 0.01;

class TokenArbitrage {
  token0: Token;
  token1: Token;

  constructor(tokenA: Token, tokenB: Token) {
    this.token0 = tokenA.address < tokenB.address ? tokenA : tokenB;
    this.token1 = tokenA.address < tokenB.address ? tokenB : tokenA;
  }

  async getPools(): Promise<Pool[]> {
    return getPools(this.token0, this.token1);
  }

  async findMaxProfitableArb(): Promise<Arb | undefined> {
    const pools = await this.getPools();
    if (pools.length < 3) {
      throw new Error(
        `Need at least 3 ${this.token0.symbol}-${this.token1.symbol} pools to do flash arbitrage`
      );
    }

    let bestArb: Arb | undefined;
    const allArbSetups = permuteAllArbs(pools);

    for (const arbSetup of allArbSetups) {
      const arb = await this._getArbProfit(arbSetup);

      if (
        arb.profit > 0 &&
        (bestArb === undefined || arb.profit > bestArb.profit)
      )
        bestArb = arb;
    }

    return bestArb;
  }

  async _getArbProfit(arbSetup: ArbSetup): Promise<Arb> {
    // assume both uniswap pools first
    const P_arb = await getPrice(
      arbSetup.firstSwapPool,
      this.token0,
      this.token1
    );
    const P_real = await getPrice(
      arbSetup.secondSwapPool,
      this.token0,
      this.token1
    );

    const token_in = P_real > P_arb ? this.token1 : this.token0;
    const token_out = token_in != this.token0 ? this.token0 : this.token1;
    const firstFee = await arbSetup.firstSwapPool.fee();
    const amount_out = +ethers.utils.formatUnits(
      999999999999,
      token_out.decimals
    );
    const sqrtPriceLimitX96 = priceToSqrtPriceX96(
      P_real,
      this.token0,
      this.token1
    );

    const quoterContract = new ethers.Contract(
      QUOTER_ADDRESS[network.name],
      Quoter.abi,
      provider
    );
    // Get optimal amount_in of token_in to arbitrage arbSetup.firstSwapPool
    let amount_in = await quoterContract.callStatic.quoteExactOutputSingle(
      token_in.address,
      token_out.address,
      firstFee,
      amount_out, // Arbitrary large amount to see how much token_in is needed to swap to get this pool's price to P_real
      sqrtPriceLimitX96
    );
    amount_in = +ethers.utils.formatUnits(amount_in, token_in.decimals);
  }
}

async function checkAndDoIfArbExistsForTokens(tokenA: Token, tokenB: Token) {
  const arb = new TokenArbitrage(tokenA, tokenB);
  const bestArb = await arb.findMaxProfitableArb();
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

// import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
// const testSqrt = new ethers.Contract(
//   arbSetup.secondSwapPool.address,
//   IUniswapV3PoolABI.abi,
//   provider
// );
// console.log(await testSqrt.slot0());
