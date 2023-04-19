import { ethers } from "hardhat";

export class Pool extends ethers.Contract {}
export class V2Pool extends Pool {}
export class V3Pool extends Pool {}

export function permuteAllArbs(pools: Pool[]): Pool[][] {
  // Generates all sets of arbitrage setups (1 flash pool, 2 swap pools)
  function generateArbs(idx: number, arr: Pool[]) {
    if (arr.length == 3) {
      arbSetups.push([arr[0], arr[1], arr[2]]);
      return;
    }
    for (let i = idx; i < pools.length; i++) {
      arr.push(pools[i]);
      generateArbs(i + 1, arr);
      arr.pop();
    }
  }

  // Permutes each arbitrage setup where index 0 is flash pool, index 1 is first swap pool, and index 2 is second swap pool in each added array
  function permute(idx: number, tup: [Pool, Pool, Pool]) {
    if (idx == tup.length) {
      allPermutedArbs.push(tup);
      return;
    }

    for (let i = idx; i < tup.length; i++) {
      [tup[idx], tup[i]] = [tup[i], tup[idx]];
      permute(idx + 1, tup);
      [tup[idx], tup[i]] = [tup[i], tup[idx]];
    }
  }

  const arbSetups: [Pool, Pool, Pool][] = [];
  generateArbs(0, []);

  const allPermutedArbs: [Pool, Pool, Pool][] = [];
  for (const arbSetup of arbSetups) {
    permute(0, arbSetup);
  }

  return allPermutedArbs;
}
