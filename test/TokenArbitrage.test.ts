import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

import { TokenArbitrage } from "../src/TokenArbitrage";
import { deployMocks } from "../src/deploy/00_deploy_mocks";
import { Token } from "@uniswap/sdk-core";

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

  it("Verify correct assignment of tokens", function () {
    const TOKEN1 = new Token(
      31337,
      "0x1111111111111111111111111111111111111111",
      18
    );
    const TOKEN2 = new Token(
      31337,
      "0x2222222222222222222222222222222222222222",
      18
    );

    let tokenArb = new TokenArbitrage(TOKEN1, TOKEN2);
    expect(tokenArb.token0.address).to.equal(TOKEN1.address);

    tokenArb = new TokenArbitrage(TOKEN2, TOKEN1);
    expect(tokenArb.token0.address).to.equal(TOKEN1.address);
  });
});
