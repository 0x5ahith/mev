import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

import { TokenArbitrage } from "../src/TokenArbitrage";
import { deployMocks } from "../src/deploy/00_deploy_mocks";

describe("Unit tests for TokenArbitrage class", function () {
  async function setUpPoolsFixture() {
    const {
      USDC_TOKEN,
      WETH_TOKEN,
      address500,
      address3000,
      address10000,
      addressSushi,
    } = await deployMocks();

    const tokenArb = new TokenArbitrage(USDC_TOKEN, WETH_TOKEN);

    return {
      tokenArb,
      address500,
      address3000,
      address10000,
      addressSushi,
    };
  }

  describe("Get pools", function () {
    it("Uniswap pools", async function () {
      const { tokenArb, address500, address3000, address10000 } =
        await loadFixture(setUpPoolsFixture);

      const pools = await tokenArb.getUniswapPools();
      expect(pools.length).to.equal(3);
      for (const pool of pools) {
        expect([address500, address3000, address10000]).to.include(
          pool.address
        );
      }
    });

    it("SushiSwap pool", async function () {
      const { tokenArb, addressSushi } = await loadFixture(setUpPoolsFixture);

      const pool = await tokenArb.getSushiswapPool();
      expect(pool).to.not.be.null;
      expect(pool?.address).to.equal(addressSushi);
    });
  });
});
