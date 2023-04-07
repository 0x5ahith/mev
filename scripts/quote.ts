import { FeeAmount } from "@uniswap/v3-sdk";
import { SupportedChainId, Token } from "@uniswap/sdk-core";
import { ethers, network } from "hardhat";
import { QUOTER_ADDRESS, SUSHI_FACTORY_ADDRESS } from "./constants";
import Quoter from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import UniswapV2Pair from "@uniswap/v2-core/build/UniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";

const provider = new ethers.providers.JsonRpcProvider(network.config.url);

async function getSushiswapPrice(tokenA: Token, tokenB: Token): number {
  const factoryContract = new ethers.Contract(
    SUSHI_FACTORY_ADDRESS[network.name],
    UniswapV2Factory.abi,
    provider
  );
  const pairAddress = await factoryContract.getPair(
    tokenA.address,
    tokenB.address
  );
  const pairContract = new ethers.Contract(
    pairAddress,
    UniswapV2Pair.abi,
    provider
  );
  const [amountA, amountB] = await pairContract.getReserves();

  const token0Address = await pairContract.token0();
  if (token0Address != tokenA.address) [tokenA, tokenB] = [tokenB, tokenA];

  return ((ethers.utils.formatUnits(amountA, tokenA.decimals) as number) /
    ethers.utils.formatUnits(amountB, tokenB.decimals)) as number;
}

async function getUniswapPrice(
  tokenA: Token,
  tokenB: Token
): Promise<[number, number][]> {
  const prices: [number, number][] = [];

  const quoterContract = new ethers.Contract(
    QUOTER_ADDRESS[network.name],
    Quoter.abi,
    provider
  );

  for (let amount of Object.values(FeeAmount)) {
    if (isNaN(Number(amount))) continue;

    amount = amount as number;
    try {
      const price: number =
        await quoterContract.callStatic.quoteExactInputSingle(
          tokenA.address,
          tokenB.address,
          amount,
          ethers.utils.parseUnits("1", tokenA.decimals),
          0
        );

      prices.push([
        ethers.utils.formatUnits(price, tokenB.decimals) as number,
        amount,
      ]);
    } catch (e) {
      console.log(e);
      console.log("No %f% fee pool", amount / 10000);
    }
  }

  return prices;
}

const WETH_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  18,
  "WETH",
  "Wrapped Ether"
);

const USDC_TOKEN = new Token(
  SupportedChainId.MAINNET,
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  6,
  "USDC",
  "USD//C"
);

async function main(): Promise<void> {
  console.log(await getSushiswapPrice(WETH_TOKEN, USDC_TOKEN));
  console.log(await getUniswapPrice(WETH_TOKEN, USDC_TOKEN));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
