import {
  FeeAmount,
  FACTORY_ADDRESS,
  computePoolAddress,
} from "@uniswap/v3-sdk";
import { SupportedChainId, Token } from "@uniswap/sdk-core";
import { ethers, network } from "hardhat";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import Quoter from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";

import { Pool, V2Pool, V3Pool, permuteAllArbs, Arb } from "./utils";

const provider = new ethers.providers.JsonRpcProvider(network.config.url);

// export async function getSushiswapPrice(tokenA: Token, tokenB: Token): number {
//   const [amountA, amountB] = await pairContract.getReserves();

//   const token0Address = await pairContract.token0();
//   if (token0Address != tokenA.address) [tokenA, tokenB] = [tokenB, tokenA];

//   return ((ethers.utils.formatUnits(amountA, tokenA.decimals) as number) /
//     ethers.utils.formatUnits(amountB, tokenB.decimals)) as number;
// }

// export async function getUniswapData(
//   tokenA: Token,
//   tokenB: Token
// ): Promise<[number, number][]> {
//   const quoterContract = new ethers.Contract(
//     QUOTER_ADDRESS[network.name],
//     Quoter.abi,
//     provider
//   );
//   const prices: [number, number][] = [];
//   for (let feeAmount of Object.values(FeeAmount)) {
//     if (isNaN(Number(feeAmount))) continue;

//     feeAmount = feeAmount as number;
//     try {
//       // Get price of tokenB in terms of tokenA
//       const price: number =
//         await quoterContract.callStatic.quoteExactInputSingle(
//           tokenA.address,
//           tokenB.address,
//           feeAmount,
//           ethers.utils.parseUnits("1", tokenA.decimals),
//           0
//         );

//       prices.push([
//         ethers.utils.formatUnits(price, tokenB.decimals) as number,
//         feeAmount,
//       ]);
//     } catch (e) {
//       console.log(e);
//       console.log("No %f% fee pool", feeAmount / 10000);
//     }
//   }

//   return prices;
// }

async function getUniswapPools(
  tokenA: Token,
  tokenB: Token
): Promise<V3Pool[]> {
  const pools: V3Pool[] = [];

  for (let feeAmount of Object.values(FeeAmount)) {
    if (isNaN(Number(feeAmount))) continue;

    feeAmount = feeAmount as number;

    const poolAddress = computePoolAddress({
      factoryAddress: FACTORY_ADDRESS,
      tokenA: tokenA,
      tokenB: tokenB,
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
        tokenA.symbol,
        tokenB.symbol
      );
    }
  }

  return pools;
}

async function getSushiswapPool(
  tokenA: Token,
  tokenB: Token
): Promise<V2Pool | null> {
  const factoryContract = new ethers.Contract(
    SUSHI_FACTORY_ADDRESS[network.name],
    UniswapV2Factory.abi,
    provider
  );
  const pairAddress = await factoryContract.getPair(
    tokenA.address,
    tokenB.address
  );
  const poolContract = new V2Pool(pairAddress, UniswapV2Pair.abi, provider);

  try {
    await poolContract.token0();
    return poolContract;
  } catch (e) {
    console.log("No %s-%s SushiSwap pool", tokenA.symbol, tokenB.symbol);
  }

  return null;
}

async function getPools(tokenA: Token, tokenB: Token): Promise<Pool[]> {
  const pools: Pool[] = await getUniswapPools(tokenA, tokenB);
  const sushiswapPool = await getSushiswapPool(tokenA, tokenB);
  if (sushiswapPool) pools.push(sushiswapPool);
  return pools;
}

// function getMaxProfitableArb();

const WETH_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  18,
  "WETH",
  "Wrapped Ether"
);

const USDC_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  6,
  "USDC",
  "USD//C"
);

const DYDX_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0x92D6C1e31e14520e676a687F0a93788B716BEff5",
  18,
  "DYDX",
  "dYdX"
);

async function main(): Promise<void> {
  const pools = await getPools(WETH_TOKEN, USDC_TOKEN);
  console.log("Total number of pools:", pools.length);
  console.log("Total permutations:", permuteAllArbs(pools).length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
