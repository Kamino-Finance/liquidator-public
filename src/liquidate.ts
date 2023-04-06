/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import {
  Connection, Keypair, PublicKey,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import {
  getWalletBalances,
  getWalletDistTarget,
  getWalletTokenData,
  wait,
} from 'libs/utils';
import { getTokensOracleData } from 'libs/oracle';
import { calculateRefreshedObligation } from 'libs/refreshObligation';
import { readSecret } from 'libs/secret';
import { liquidateAndRedeem } from 'libs/actions/liquidateAndRedeem';
import { rebalanceWallet } from 'libs/rebalanceWallet';
import { Jupiter } from '@jup-ag/core';
// import { unwrapTokens } from 'libs/unwrap/unwrapToken';
import express from 'express';
import {
  KaminoMarket, ENV, KAMINO_LENDING_DEVNET_PROGRAM_ID, Obligation,
} from '@hubbleprotocol/kamino-lending-sdk';
import { getAllObligationsForMarket } from 'models/layouts/obligation';
import { getMarkets } from './config';
import logger from './services/logger';

dotenv.config({ path: `.env.${process.env.CLUSTER}` });
const app = express();

async function runLiquidator() {
  const rpcEndpoint = process.env.RPC_ENDPOINT;
  if (!rpcEndpoint) {
    throw new Error(
      'Pls provide an private RPC endpoint in the env config file',
    );
  }
  const markets = await getMarkets();
  const connection = new Connection(rpcEndpoint, 'confirmed');
  // liquidator's keypair.
  const payer = Keypair.fromSecretKey(Buffer.from(JSON.parse(readSecret('keypair'))));

  const cluster = process.env.CLUSTER === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
  const jupiter = await Jupiter.load({
    connection,
    cluster,
    user: Keypair.fromSecretKey(payer.secretKey),
    wrapUnwrapSOL: false,
  });
  const target = getWalletDistTarget();

  logger.info({
    message: `Liquidator running against ${markets.length} pools`,
    app: `${process.env.CLUSTER}`,
    rpc: `${rpcEndpoint}`,
    wallet: `${payer.publicKey.toBase58()}`,
    autoRebalancing: `${target.length > 0 ? 'ON' : 'OFF'}`,
    rebalancingDistribution: `${process.env.TARGETS}`,
  });

  for (let epoch = 0; ; epoch += 1) {
    for (const market of markets) {
      const kaminoMarket = await KaminoMarket.initialize(
        connection,
        KAMINO_LENDING_DEVNET_PROGRAM_ID,
        market.lendingMarket,
        process.env.CLUSTER as ENV,
      );

      const tokensOracle = await getTokensOracleData(connection, kaminoMarket);
      const allObligations = await getAllObligationsForMarket(kaminoMarket, connection);
      const walletBalances = await getWalletBalances(connection, payer, tokensOracle, kaminoMarket);

      logger.info(`Liquidator looping through ${allObligations.length} obligations for market: ${market.lendingMarket}`);

      // eslint-disable-next-line prefer-const
      for (let { obligation, obligationAddress } of allObligations) {
        try {
          while (obligation) {
            const {
              borrowedValue, unhealthyBorrowValue, deposits, borrows,
            } = calculateRefreshedObligation(
              obligation,
              kaminoMarket.reserves,
              tokensOracle,
            );

            if (Number.isNaN(borrowedValue) || Number.isNaN(unhealthyBorrowValue)) {
              logger.warn(`Obligation ${obligationAddress.toString()} has NaN values`);
              break;
            }

            // Do nothing if obligation is healthy
            if (borrowedValue.isLessThanOrEqualTo(unhealthyBorrowValue)) {
              break;
            }

            // select repay token that has the highest market value
            let selectedBorrow: any;
            borrows.forEach((borrow) => {
              if (
                !selectedBorrow
                                      || borrow.marketValue.gt(selectedBorrow.marketValue)
              ) {
                selectedBorrow = borrow;
              }
            });

            // select the withdrawal collateral token with the highest market value
            let selectedDeposit: any;
            deposits.forEach((deposit) => {
              if (
                !selectedDeposit
                                      || deposit.marketValue.gt(selectedDeposit.marketValue)
              ) {
                selectedDeposit = deposit;
              }
            });

            if (!selectedBorrow || !selectedDeposit) {
              logger.warn(`Skipping obligation ${obligationAddress.toString()} caused by toxic oracle data`);
              // skip toxic obligations caused by toxic oracle data
              break;
            }

            logger.warn({
              message: `Obligation ${obligationAddress.toString()} is underwater`,
              borrowedValue: `${borrowedValue.toString()}`,
              unhealthyBorrowValue: `${unhealthyBorrowValue.toString()}`,
              marketAddress: `${market.lendingMarket}`,
            });

            // get wallet balance for selected borrow token
            const { balanceBase } = await getWalletTokenData(
              connection,
              kaminoMarket,
              payer,
              selectedBorrow.mintAddress,
              selectedBorrow.symbol,
            );
            if (balanceBase === 0) {
              logger.warn(
                `insufficient ${
                  selectedBorrow.symbol
                } to liquidate obligation ${obligationAddress.toString()} in market: ${
                  market.lendingMarket
                }`,
              );
            } else if (balanceBase < 0) {
              logger.warn(`failed to get wallet balance for ${
                selectedBorrow.symbol
              } to liquidate obligation ${obligationAddress.toString()} in market: ${
                market.lendingMarket
              }. 
                                    Potentially network error or token account does not exist in wallet`);
              break;
            }

            const kaminoObligation = {
              pubkey: obligationAddress,
              info: obligation,
            };

            // Set super high liquidation amount which acts as u64::MAX as program will only liquidate max
            // 50% val of all borrowed assets.
            logger.info(`Trying to liquidate obligation ${obligationAddress.toString()}, committing ${balanceBase} for liquidation, repaying token ${selectedBorrow.symbol} and withdrawing collateral token ${selectedDeposit.symbol}`);

            await liquidateAndRedeem(
              connection,
              payer,
              balanceBase,
              selectedBorrow.symbol,
              selectedDeposit.symbol,
              kaminoMarket,
              kaminoObligation,
            );

            const postLiquidationObligation = await connection.getAccountInfo(
              new PublicKey(obligationAddress),
            );
            obligation = Obligation.decode(postLiquidationObligation?.data!);
          }
        } catch (err) {
          logger.error(
            `Error ${err} liquidating obligation ${obligationAddress.toString()}`,
          );
          continue;
        }
      }
      // if (cluster === 'mainnet-beta') {
      //   await unwrapTokens(connection, payer);
      // }

      if (target.length > 0 && cluster === 'mainnet-beta') {
        await rebalanceWallet(connection, payer, jupiter, tokensOracle, walletBalances, target);
      }

      // Throttle to avoid rate limiter
      if (process.env.THROTTLE) {
        await wait(Number(process.env.THROTTLE));
      }
    }
  }
}

const port = process.env.SERVER_PORT || 8888;

app.listen(port, () => {
  logger.info('✅️kamino-lending-liquidations-bot is running');
});

app.get(['/health', '/health/liveness', '/health/readiness'], (req, res) => {
  res.send('ok');
});

async function recursiveTryCatch(f: () => void) {
  try {
    f();
  } catch (e) {
    logger.error(e);
    await sleep(500);
    await recursiveTryCatch(f);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

recursiveTryCatch(() => runLiquidator());
