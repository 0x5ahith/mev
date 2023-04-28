import { Token } from "@uniswap/sdk-core";

export type deployFactoryResponse = {
  uniswapFactory: ethers.Contract;
  sushiswapFactory: ethers.Contract;
};

export type deployTokensResponse = {
  USDC_TOKEN: Token;
  WETH_TOKEN: Token;
};

export type deployPoolsResponse = {
  address500: string;
  address3000: string;
  address10000: string;
  addressSushi: string;
};

export type deployMocksResponse = deployTokensResponse & deployPoolsResponse;
