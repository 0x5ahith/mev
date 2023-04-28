import { ethers } from "hardhat";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { Token } from "@uniswap/sdk-core";

import UniswapV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SushiswapV2Factory from "@sushiswap/sushiswap/deployments/ethereum/UniswapV2Factory.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";

import {
  deployFactoryResponse,
  deployMocksResponse,
  deployPoolsResponse,
  deployTokensResponse,
} from "../types";

async function deployFactories(): Promise<deployFactoryResponse> {
  // Deploy Uniswap factory
  const uniswapDeployerAddress = "0x6C9FC64A53c1b71FB3f9Af64d1ae3A4931A5f4E9";
  const uniswapDeployer = await ethers.getImpersonatedSigner(
    uniswapDeployerAddress
  );
  setBalance(uniswapDeployerAddress, 100e18);
  const UniswapFactory = (
    await ethers.getContractFactory(
      UniswapV3Factory.abi,
      UniswapV3Factory.bytecode
    )
  ).connect(uniswapDeployer);

  const uniswapFactory = await UniswapFactory.deploy();
  console.log("Uniswap factory address:", uniswapFactory.address);

  // Deploy SushiSwap factory
  // TODO: use deploy plugin
  const sushiswapDeployerAddress = "0xF942Dba4159CB61F8AD88ca4A83f5204e8F4A6bd";
  const sushiswapDeployer = await ethers.getImpersonatedSigner(
    sushiswapDeployerAddress
  );
  setBalance(sushiswapDeployerAddress, 100e18);
  const SushiswapFactory = (
    await ethers.getContractFactory(
      SushiswapV2Factory.abi,
      SushiswapV2Factory.bytecode
    )
  ).connect(sushiswapDeployer);
  const sushiswapFactory = await SushiswapFactory.deploy(
    sushiswapDeployer.address
  );
  console.log("SushiSwap factory address:", sushiswapFactory.address);

  return { uniswapFactory, sushiswapFactory };
}

async function deployTokens(): Promise<deployTokensResponse> {
  // Deploy tokens
  const ERC20Token = await ethers.getContractFactory(ERC20.abi, ERC20.bytecode);
  const usdc = await ERC20Token.deploy("USD Coin", "USDC");
  const weth = await ERC20Token.deploy("Wrapped Ether", "WETH");
  const USDC_TOKEN = new Token(31337, usdc.address, 6, await usdc.symbol());
  const WETH_TOKEN = new Token(31337, weth.address, 18, await weth.symbol());

  return { USDC_TOKEN, WETH_TOKEN };
}

async function deployPools(
  uniswapFactory: ethers.Contract,
  sushiswapFactory: ethers.Contract,
  token0: Token,
  token1: Token
): Promise<deployPoolsResponse> {
  // Deploy Uniswap v3 pools
  const getPoolAddress = async (txResponse) => {
    const txReceipt = await txResponse.wait();
    const [poolCreatedEvent] = txReceipt.events;
    const { pool } = poolCreatedEvent.args;
    return pool;
  };
  console.log("Deploying Uniswap pools...");
  const address500 = await getPoolAddress(
    await uniswapFactory.createPool(token0.address, token1.address, 500)
  );
  const address3000 = await getPoolAddress(
    await uniswapFactory.createPool(token0.address, token1.address, 3000)
  );
  const address10000 = await getPoolAddress(
    await uniswapFactory.createPool(token0.address, token1.address, 10000)
  );
  console.log("Deployed Uniswap pools...");

  console.log("Deploying SushiSwap pool...");
  const txResponse = await sushiswapFactory.createPair(
    token0.address,
    token1.address
  );
  const txReceipt = await txResponse.wait();
  const [pairCreatedEvent] = txReceipt.events;
  const { pair } = pairCreatedEvent.args;
  const addressSushi = pair;
  console.log("Deployed SushiSwap pool...");

  return { address500, address3000, address10000, addressSushi };
}

export async function deployMocks(): Promise<deployMocksResponse> {
  const { uniswapFactory, sushiswapFactory } = await deployFactories();
  const { USDC_TOKEN, WETH_TOKEN } = await deployTokens();
  const { address500, address3000, address10000, addressSushi } =
    await deployPools(uniswapFactory, sushiswapFactory, USDC_TOKEN, WETH_TOKEN);

  return {
    USDC_TOKEN,
    WETH_TOKEN,
    address500,
    address3000,
    address10000,
    addressSushi,
  };
}

async function main() {
  // await deployMocks();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
