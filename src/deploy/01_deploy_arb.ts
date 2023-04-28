import { FACTORY_ADDRESS } from "@uniswap/v3-sdk";
import { ethers } from "hardhat";

async function main() {
  const FlashArb = await ethers.getContractFactory("FlashArb");
  const flashArb = await FlashArb.deploy(unlockTime,,FACTORY_ADDRESS);

  await flashArb.deployed();

  console.log(`FlashArb deployed to ${flashArb.address}`);
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
