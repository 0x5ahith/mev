import { FACTORY_ADDRESS } from "@uniswap/v3-sdk";
import { ethers } from "hardhat";
import { SUSHI_ROUTER, UNISWAP_ROUTER } from "../constants";

async function main() {
  const FlashArb = await ethers.getContractFactory("FlashArb");
  const flashArb = await FlashArb.deploy(
    UNISWAP_ROUTER,
    SUSHI_ROUTER,
    FACTORY_ADDRESS
  );

  await flashArb.deployed();

  console.log(`FlashArb deployed to ${flashArb.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
