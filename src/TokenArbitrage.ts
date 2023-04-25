import { Token } from "@uniswap/sdk-core";
import {
  FeeAmount,
  computePoolAddress,
  FACTORY_ADDRESS,
} from "@uniswap/v3-sdk";
import { ethers, network } from "hardhat";

import Quoter from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";

import {
  QUOTER_ADDRESS,
  SUSHI_FACTORY_ADDRESS,
  SLIPPAGE,
  SUSHISWAP_FEE,
} from "./constants";
import {
  fromReadableAmount,
  permuteAllArbs,
  priceToSqrtPriceX96,
  getProvider,
  sushiswapOut,
  toReadableAmount,
} from "./utils";

export interface ArbSetup {
  flashPool: Pool;
  firstSwapPool: Pool;
  secondSwapPool: Pool;
}

export interface Arb {
  profit: number; // token1 in terms of token0
  pools: ArbSetup;
  flashToken: Token;
  flashAmount: number;
  firstSwapOutMin: number;
  secondSwapOutMin: number;
}

export class Pool extends ethers.Contract {}
export class V2Pool extends Pool {}
export class V3Pool extends Pool {}

export class TokenArbitrage {
  token0: Token;
  token1: Token;

  constructor(tokenA: Token, tokenB: Token) {
    this.token0 = tokenA.address < tokenB.address ? tokenA : tokenB;
    this.token1 = tokenA.address < tokenB.address ? tokenB : tokenA;
  }

  async findMaxProfitableArbFromPools(pools: Pool[]): Promise<Arb | undefined> {
    const allArbSetups = permuteAllArbs(pools);
    let bestArb: Arb | undefined;

    for (const arbSetup of allArbSetups) {
      if (arbSetup.flashPool instanceof V2Pool) continue; // Using only UniswapV3 pools for flash swap

      const arb = await this.checkIfArbProfitable(arbSetup);
      if (
        arb.profit > 0 &&
        (bestArb === undefined || arb.profit > bestArb.profit)
      )
        bestArb = arb;
    }

    return bestArb;
  }

  async checkIfArbProfitable(arbSetup: ArbSetup): Promise<Arb> {
    const [tokenA, tokenB, pArb, pReal] = await this._getTokensAndPrices(
      arbSetup
    );
    const arbInfo: Arb = {
      profit: -1,
      pools: arbSetup,
      flashToken: tokenA,
      flashAmount: -1,
      firstSwapOutMin: -1,
      secondSwapOutMin: -1,
    };

    let amountAIn, amountBOut, amountAFinal;

    try {
      [amountAIn, amountBOut] = await this._getArbitrageSwapOut(arbSetup);
      arbInfo.flashAmount = amountAIn;
      arbInfo.firstSwapOutMin = amountBOut;
      if (amountAIn < 0 || amountBOut < 0) return arbInfo;

      amountAFinal = await this._getProfitSwapOut(arbSetup, amountBOut);
      arbInfo.secondSwapOutMin = amountAFinal;
    } catch (e) {
      if (e.reason === "SPL") return arbInfo;
      throw e;
    }

    let profit = amountAFinal - amountAIn;
    console.log(
      `Profit of ${toReadableAmount(profit, tokenA.decimals)} ${tokenA.symbol}`
    );
    console.log();
    if (profit < 0) return arbInfo;

    // add flash fees
    const flashPoolFee = await arbSetup.flashPool.fee();
    const flashFee = (amountAIn * flashPoolFee) / 1e6;
    profit -= flashFee;

    // add gas costs

    arbInfo.profit = profit;

    return arbInfo;
  }

  async _getTokensAndPrices(
    arbSetup: ArbSetup
  ): Promise<[Token, Token, number, number]> {
    const pArb = await this.getPrice(arbSetup.firstSwapPool);
    const pReal = await this.getPrice(arbSetup.secondSwapPool);
    const tokenA = pReal > pArb ? this.token1 : this.token0;
    const tokenB = tokenA != this.token0 ? this.token0 : this.token1;

    return [tokenA, tokenB, pArb, pReal];
  }

  async _getArbitrageSwapOut(arbSetup: ArbSetup): Promise<[number, number]> {
    const [tokenA, tokenB, pArb, pReal] = await this._getTokensAndPrices(
      arbSetup
    );
    let amountAIn, amountBOut;

    if (arbSetup.firstSwapPool instanceof V2Pool) {
      // SushiSwap pool
      const k = 1 - SUSHISWAP_FEE;
      const [r0, r1] = await arbSetup.firstSwapPool.getReserves();
      const pRealAdjusted =
        pReal * 10 ** (this.token1.decimals - this.token0.decimals);

      if (tokenA == this.token0) {
        amountAIn = Math.sqrt((r0 * r1) / (pRealAdjusted * k)) - r0 / k;
        amountBOut = sushiswapOut(amountAIn, r0, r1, SUSHISWAP_FEE);
      } else {
        amountAIn = Math.sqrt((pRealAdjusted * r0 * r1) / k) - r1 / k;
        amountBOut = sushiswapOut(amountAIn, r1, r0, SUSHISWAP_FEE);
      }
    } else {
      // Uniswap pool
      const firstFee = await arbSetup.firstSwapPool.fee();
      const tokenBLimit = fromReadableAmount(1e20, tokenB.decimals);
      const sqrtPriceLimitX96 = priceToSqrtPriceX96(
        pReal,
        this.token0,
        this.token1
      );

      const quoterContract = new ethers.Contract(
        QUOTER_ADDRESS[network.name],
        Quoter.abi,
        getProvider()
      );
      // Get optimal amountAIn of tokenA to arbitrage arbSetup.firstSwapPool
      amountAIn = await quoterContract.callStatic.quoteExactOutputSingle(
        tokenA.address,
        tokenB.address,
        firstFee,
        tokenBLimit, // Arbitrary large amount to see how much tokenA is needed to swap to get this pool's price to pReal
        sqrtPriceLimitX96
      );

      amountBOut = await quoterContract.callStatic.quoteExactInputSingle(
        tokenA.address,
        tokenB.address,
        firstFee,
        amountAIn,
        sqrtPriceLimitX96
      );
    }

    return [amountAIn, amountBOut];
  }

  async _getProfitSwapOut(
    arbSetup: ArbSetup,
    amountBIn: number
  ): Promise<number> {
    const [tokenA, tokenB, , pReal] = await this._getTokensAndPrices(arbSetup);
    let amountAFinal;

    if (arbSetup.secondSwapPool instanceof V2Pool) {
      // SushiSwap pool
      const [r0, r1] = await arbSetup.secondSwapPool.getReserves();
      amountAFinal =
        tokenB == this.token0
          ? sushiswapOut(amountBIn, r0, r1, SUSHISWAP_FEE)
          : sushiswapOut(amountBIn, r1, r0, SUSHISWAP_FEE);
    } else {
      // Uniswap pool
      const secondFee = await arbSetup.secondSwapPool.fee();
      const zeroForOne = tokenB.address < tokenA.address;
      const pRealSlippage = zeroForOne
        ? pReal * (1 - SLIPPAGE)
        : pReal * (1 + SLIPPAGE);

      const quoterContract = new ethers.Contract(
        QUOTER_ADDRESS[network.name],
        Quoter.abi,
        getProvider()
      );
      amountAFinal = await quoterContract.callStatic.quoteExactInputSingle(
        tokenB.address,
        tokenA.address,
        secondFee,
        amountBIn,
        priceToSqrtPriceX96(pRealSlippage, this.token0, this.token1)
      );
    }

    return amountAFinal;
  }

  async getPools(): Promise<Pool[]> {
    const pools: Pool[] = await this.getUniswapPools();
    const sushiswapPool = await this.getSushiswapPool();
    if (sushiswapPool) pools.push(sushiswapPool);
    return pools;
  }

  async getUniswapPools(): Promise<V3Pool[]> {
    const pools: V3Pool[] = [];

    for (let feeAmount of Object.values(FeeAmount)) {
      if (isNaN(Number(feeAmount))) continue;

      feeAmount = feeAmount as number;

      const poolAddress = computePoolAddress({
        factoryAddress: FACTORY_ADDRESS,
        tokenA: this.token0,
        tokenB: this.token1,
        fee: feeAmount,
      });
      const poolContract = new V3Pool(
        poolAddress,
        IUniswapV3PoolABI.abi,
        getProvider()
      );

      try {
        await poolContract.fee();
        pools.push(poolContract);
      } catch (e) {
        console.log(
          "No %f% fee %s-%s Uniswap pool",
          feeAmount / 10000,
          this.token0.symbol,
          this.token1.symbol
        );
      }
    }

    return pools;
  }

  async getSushiswapPool(): Promise<V2Pool | null> {
    const factoryContract = new ethers.Contract(
      SUSHI_FACTORY_ADDRESS[network.name],
      UniswapV2Factory.abi,
      getProvider()
    );
    const pairAddress = await factoryContract.getPair(
      this.token0.address,
      this.token1.address
    );
    const poolContract = new V2Pool(
      pairAddress,
      UniswapV2Pair.abi,
      getProvider()
    );

    try {
      await poolContract.token0();
      return poolContract;
    } catch (e) {
      console.log(
        "No %s-%s SushiSwap pool",
        this.token0.symbol,
        this.token1.symbol
      );
    }

    return null;
  }

  // gets price of token0 (token1/token0)
  async getPrice(pool: Pool): Promise<number> {
    if (pool instanceof V2Pool) {
      return await this.getSushiswapPrice(pool);
    }
    return await this.getUniswapPrice(pool);
  }

  async getUniswapPrice(pool: V3Pool): Promise<number> {
    const quoterContract = new ethers.Contract(
      QUOTER_ADDRESS[network.name],
      Quoter.abi,
      getProvider()
    );
    const price = await quoterContract.callStatic.quoteExactInputSingle(
      this.token0.address,
      this.token1.address,
      await pool.fee(),
      ethers.utils.parseUnits("1", this.token0.decimals),
      0
    );
    return +ethers.utils.formatUnits(price, this.token1.decimals);
  }

  async getSushiswapPrice(pool: V2Pool): Promise<number> {
    let [amount0, amount1] = await pool.getReserves();
    const token0Address = await pool.token0();
    if (token0Address != this.token0.address)
      [amount0, amount1] = [amount1, amount0];

    return (
      +ethers.utils.formatUnits(amount1, this.token1.decimals) /
      +ethers.utils.formatUnits(amount0, this.token0.decimals)
    );
  }
}
