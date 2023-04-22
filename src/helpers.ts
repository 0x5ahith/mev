import { Token } from "@uniswap/sdk-core";
import { ethers, network } from "hardhat";
import { ArbSetup, Pool } from "./TokenArbitrage";

export const provider = new ethers.providers.JsonRpcProvider(
  network.config.url
);

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

export function fromReadableAmount(
  amount: number,
  decimals: number
): ethers.BigNumber {
  return ethers.utils.parseUnits(amount.toString(), decimals);
}

export function toReadableAmount(rawAmount: number, decimals: number): string {
  return (+ethers.utils.formatUnits(rawAmount, decimals)).toFixed(3).toString();
}
