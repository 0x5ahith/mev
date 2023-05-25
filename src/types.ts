import { Token } from "@uniswap/sdk-core";

export type DeployFactoryResponse = {
  uniswapFactory: ethers.Contract;
  sushiswapFactory: ethers.Contract;
};

export type DeployTokensResponse = {
  USDC_TOKEN: Token;
  WETH_TOKEN: Token;
};

export type DeployPoolsResponse = {
  address500: string;
  address3000: string;
  address10000: string;
  addressSushi: string;
};

export type DeployMocksResponse = DeployTokensResponse & DeployPoolsResponse;
