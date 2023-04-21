import { Token } from "@uniswap/sdk-core";
import {
  FACTORY_ADDRESS,
  FeeAmount,
  computePoolAddress,
} from "@uniswap/v3-sdk";
import { ethers, network } from "hardhat";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import Quoter from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";

import { SUSHI_FACTORY_ADDRESS, QUOTER_ADDRESS } from "./constants";

export const provider = new ethers.providers.JsonRpcProvider(
  network.config.url
);

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

export async function getPools(token0: Token, token1: Token): Promise<Pool[]> {
  const pools: Pool[] = await getUniswapPools(token0, token1);
  const sushiswapPool = await getSushiswapPool(token0, token1);
  if (sushiswapPool) pools.push(sushiswapPool);
  return pools;
}

async function getUniswapPools(
  token0: Token,
  token1: Token
): Promise<V3Pool[]> {
  const pools: V3Pool[] = [];

  for (let feeAmount of Object.values(FeeAmount)) {
    if (isNaN(Number(feeAmount))) continue;

    feeAmount = feeAmount as number;

    const poolAddress = computePoolAddress({
      factoryAddress: FACTORY_ADDRESS,
      tokenA: token0,
      tokenB: token1,
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
        token0.symbol,
        token1.symbol
      );
    }
  }

  return pools;
}

async function getSushiswapPool(
  token0: Token,
  token1: Token
): Promise<V2Pool | null> {
  const factoryContract = new ethers.Contract(
    SUSHI_FACTORY_ADDRESS[network.name],
    UniswapV2Factory.abi,
    provider
  );
  const pairAddress = await factoryContract.getPair(
    token0.address,
    token1.address
  );
  const poolContract = new V2Pool(pairAddress, UniswapV2Pair.abi, provider);

  try {
    await poolContract.token0();
    return poolContract;
  } catch (e) {
    console.log("No %s-%s SushiSwap pool", token0.symbol, token1.symbol);
  }

  return null;
}

// gets price of token0 (token1/token0)
export async function getPrice(
  pool: Pool,
  token0: Token,
  token1: Token
): Promise<number> {
  if (pool instanceof V3Pool) {
    return await getUniswapPrice(pool, token0, token1);
  }
  return await getSushiswapPrice(pool, token0, token1);
}

async function getUniswapPrice(
  pool: V3Pool,
  token0: Token,
  token1: Token
): Promise<number> {
  const quoterContract = new ethers.Contract(
    QUOTER_ADDRESS[network.name],
    Quoter.abi,
    provider
  );
  const price = await quoterContract.callStatic.quoteExactInputSingle(
    token0.address,
    token1.address,
    await pool.fee(),
    ethers.utils.parseUnits("1", token0.decimals),
    0
  );
  return +ethers.utils.formatUnits(price, token1.decimals);
}

async function getSushiswapPrice(
  pool: V2Pool,
  token0: Token,
  token1: Token
): Promise<number> {
  let [amount0, amount1] = await pool.getReserves();
  const token0Address = await pool.token0();
  if (token0Address != token0.address) [amount0, amount1] = [amount1, amount0];

  return (
    +ethers.utils.formatUnits(amount1, token1.decimals) /
    +ethers.utils.formatUnits(amount0, token0.decimals)
  );
}

export function permuteAllArbs(pools: Pool[]): ArbSetup[] {
  // Generates all sets of arbitrage pools (3 pools: 1 flash pool, 2 swap pools)
  function generateArbPoolSets(idx: number, arr: Pool[]) {
    if (arr.length == 3) {
      arbPoolSets.push([arr[0], arr[1], arr[2]]);
      return;
    }
    for (let i = idx; i < pools.length; i++) {
      arr.push(pools[i]);
      generateArbPoolSets(i + 1, arr);
      arr.pop();
    }
  }

  // Permutes each arbitrage pool set to create an arbitrage setup where index 0 is flash pool, index 1 is first swap pool, and index 2 is second swap pool
  function permute(idx: number, tup: [Pool, Pool, Pool]) {
    if (idx == tup.length) {
      allArbSetups.push({
        flashPool: tup[0],
        firstSwapPool: tup[1],
        secondSwapPool: tup[2],
      });
      return;
    }

    for (let i = idx; i < tup.length; i++) {
      [tup[idx], tup[i]] = [tup[i], tup[idx]];
      permute(idx + 1, tup);
      [tup[idx], tup[i]] = [tup[i], tup[idx]];
    }
  }

  const arbPoolSets: [Pool, Pool, Pool][] = [];
  generateArbPoolSets(0, []);

  const allArbSetups: ArbSetup[] = [];
  for (const arbPoolSet of arbPoolSets) {
    permute(0, arbPoolSet);
  }

  return allArbSetups;
}

// where P_b_a is price of token0 (token1/token0)
export function priceToSqrtPriceX96(
  P_b_a: number,
  token0: Token,
  token1: Token
): bigint {
  return BigInt(
    Math.sqrt(P_b_a * (10 ** token1.decimals / 10 ** token0.decimals)) * 2 ** 96
  );
}
