import { SupportedChainId, Token } from "@uniswap/sdk-core";

export const WETH_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  18,
  "WETH",
  "Wrapped Ether"
);

export const USDC_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  6,
  "USDC",
  "USD//C"
);

export const DYDX_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0x92D6C1e31e14520e676a687F0a93788B716BEff5",
  18,
  "DYDX",
  "dYdX"
);
