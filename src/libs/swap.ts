/* eslint-disable prefer-promise-reject-errors */
import { Jupiter } from '@jup-ag/core';
import {
  Connection, Keypair, PublicKey,
} from '@solana/web3.js';
import { TokenInfo } from 'global';
import logger from 'services/logger';

const SLIPPAGE = 2;
const SWAP_TIMEOUT_SEC = 20;

export default async function swap(connection: Connection, wallet: Keypair, jupiter: Jupiter, fromTokenInfo: TokenInfo, toTokenInfo: TokenInfo, amount: number) {
  logger.info(`Swapping ${amount} ${fromTokenInfo.symbol} to ${toTokenInfo.symbol}...`);

  const inputMint = new PublicKey(fromTokenInfo.mintAddress);
  const outputMint = new PublicKey(toTokenInfo.mintAddress);
  try {
    const routes = await jupiter.computeRoutes({
      inputMint, // Mint address of the input token
      outputMint, // Mint address of the output token
      inputAmount: amount, // raw input amount of tokens
      slippage: SLIPPAGE, // The slippage in % terms
    });

    // Prepare execute exchange
    const { execute } = await jupiter.exchange({
      routeInfo: routes.routesInfos[0],
    });

    // Execute swap
    await new Promise((resolve, reject) => {
    // sometime jup hangs hence the timeout here.
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        logger.warn(`Swap took longer than ${SWAP_TIMEOUT_SEC} seconds to complete.`);
        reject('Swap timed out');
      }, SWAP_TIMEOUT_SEC * 1000);

      execute().then((swapResult: any) => {
        if (!timedOut) {
          clearTimeout(timeoutHandle);

          logger.info(`Successfully swapped ${swapResult.inputAmount / fromTokenInfo.decimals} ${fromTokenInfo.symbol} (mint address ${swapResult.inputAddress.toString()}) to ${swapResult.outputAmount / toTokenInfo.decimals} ${toTokenInfo.symbol} (mint address ${swapResult.outputAddress.toString()}) in tx ${swapResult.txid}`);
          resolve(swapResult);
        }
      }).catch((swapError) => {
        if (!timedOut) {
          clearTimeout(timeoutHandle);
          logger.error(`Error swapping ${swapError.error} while swapping tx ${swapError.txid} from ${fromTokenInfo.symbol} -> to ${toTokenInfo.symbol}`);
          resolve(swapError);
        }
      });
    });
  } catch (e) {
    logger.error(`No routes found for ${fromTokenInfo.symbol} -> ${toTokenInfo.symbol} `, e);
  }
}
