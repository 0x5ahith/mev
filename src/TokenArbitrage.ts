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
  provider,
  sushiswapOut,
  toReadableAmount,
} from "./helpers";

export interface ArbSetup {
  flashPool: Pool;
  firstSwapPool: Pool;
  secondSwapPool: Pool;
}

export interface Arb {
  profit: number; // token1 in terms of token0
  pools: ArbSetup;
  flashToken: string;
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
    const [amountAIn, amountBOut] = await this._getArbitrageSwapOut(arbSetup);
    const amountAFinal = await this._getProfitSwapOut(arbSetup, amountBOut);

    // Collect profits by swapping amountBOut of tokenB on arbSetup.secondSwapPool back to tokenA
    const profit = amountAFinal - amountAIn;
    const pArb = await this.getPrice(arbSetup.firstSwapPool);
    const pReal = await this.getPrice(arbSetup.secondSwapPool);
    const tokenA = pReal > pArb ? this.token1 : this.token0;
    console.log(
      `Profit of ${toReadableAmount(profit, tokenA.decimals)} ${tokenA.symbol}`
    );
    if (profit < 0) {
      return {
        profit: profit,
        pools: arbSetup,
        flashToken: "",
        flashAmount: -1,
        firstSwapOutMin: -1,
        secondSwapOutMin: -1,
      };
    }

    // add flash fees
    const flashPoolFee = await arbSetup.flashPool.fee();
    const flashFee = (amountAIn * flashPoolFee) / 1e6;

    // add gas costs
  }

  async _getArbitrageSwapOut(arbSetup: ArbSetup): Promise<[number, number]> {
    const pArb = await this.getPrice(arbSetup.firstSwapPool);
    const pReal = await this.getPrice(arbSetup.secondSwapPool);

    const tokenA = pReal > pArb ? this.token1 : this.token0;
    const tokenB = tokenA != this.token0 ? this.token0 : this.token1;

    let amountAIn, amountBOut;

    if (arbSetup.firstSwapPool instanceof V2Pool) {
      // SushiSwap pool
      const k = 1 - SUSHISWAP_FEE;

      // First swap
      const [r0, r1] = await arbSetup.firstSwapPool.getReserves();

      if (tokenA == this.token0) {
        amountAIn = Math.sqrt((r0 * r1) / (pReal * k)) - r0 / k;
        amountBOut = sushiswapOut(amountAIn, r0, r1, SUSHISWAP_FEE);
      } else {
        amountAIn = Math.sqrt((pReal * r0 * r1) / k) - r1 / k;
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
        provider
      );
      // Get optimal amountAIn of tokenA to arbitrage arbSetup.firstSwapPool
      amountAIn = await quoterContract.callStatic.quoteExactOutputSingle(
        tokenA.address,
        tokenB.address,
        firstFee,
        tokenBLimit, // Arbitrary large amount to see how much tokenA is needed to swap to get this pool's price to pReal
        sqrtPriceLimitX96
      );
      console.log(
        `${toReadableAmount(amountAIn, tokenA.decimals)} ${
          tokenA.symbol
        } needed to arbitrage pool 1 of price ${pArb} to pool 2 of price ${pReal}`
      );
      amountBOut = await quoterContract.callStatic.quoteExactInputSingle(
        tokenA.address,
        tokenB.address,
        firstFee,
        amountAIn,
        sqrtPriceLimitX96
      );
      console.log(
        `${toReadableAmount(amountBOut, tokenB.decimals)} ${
          tokenB.symbol
        } received from ${toReadableAmount(amountAIn, tokenA.decimals)} ${
          tokenA.symbol
        } on Pool 1`
      );
    }

    return [amountAIn, amountBOut];
  }

  async _getProfitSwapOut(
    arbSetup: ArbSetup,
    amountBIn: number
  ): Promise<number> {
    const pArb = await this.getPrice(arbSetup.firstSwapPool);
    const pReal = await this.getPrice(arbSetup.secondSwapPool);

    const tokenA = pReal > pArb ? this.token1 : this.token0;
    const tokenB = tokenA != this.token0 ? this.token0 : this.token1;

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
        provider
      );
      amountAFinal = await quoterContract.callStatic.quoteExactInputSingle(
        tokenB.address,
        tokenA.address,
        secondFee,
        amountBIn,
        priceToSqrtPriceX96(pRealSlippage, this.token0, this.token1)
      );
      console.log(
        `${toReadableAmount(amountAFinal, tokenA.decimals)} ${
          tokenA.symbol
        } received from ${toReadableAmount(amountBIn, tokenB.decimals)} ${
          tokenB.symbol
        } on Pool 2`
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
        provider
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
      provider
    );
    const pairAddress = await factoryContract.getPair(
      this.token0.address,
      this.token1.address
    );
    const poolContract = new V2Pool(pairAddress, UniswapV2Pair.abi, provider);

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
    if (pool instanceof V3Pool) {
      return await this.getUniswapPrice(pool);
    }
    return await this.getSushiswapPrice(pool);
  }

  async getUniswapPrice(pool: V3Pool): Promise<number> {
    const quoterContract = new ethers.Contract(
      QUOTER_ADDRESS[network.name],
      Quoter.abi,
      provider
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

// import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
// const testSqrt = new ethers.Contract(
//   arbSetup.secondSwapPool.address,
//   IUniswapV3PoolABI.abi,
//   provider
// );
// console.log(await testSqrt.slot0());
