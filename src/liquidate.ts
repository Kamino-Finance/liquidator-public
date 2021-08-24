/* eslint-disable no-constant-condition */
/* eslint-disable no-restricted-syntax */
import {
  Account,
  Connection,
  PublicKey,
} from '@solana/web3.js';
import _ from 'underscore';
import dotenv from 'dotenv';
import { liquidateObligation } from 'libs/actions/liquidateObligation';
import { ObligationParser } from 'models/layouts/obligation';
import {
  getCollateralBalances,
  getObligations, getReserves, U64_MAX, wait,
} from 'libs/utils';
import { getTokensOracleData } from 'libs/pyth';
import { calculateRefreshedObligation } from 'libs/refreshObligation';
import { redeemCollateral } from 'libs/actions/redeemCollateral';
import { readSecret } from 'libs/secret';
import { clusterUrl, config } from './config';

dotenv.config();

async function runLiquidator() {
  const lendingMarkets = _.findWhere(config.markets, { name: 'main' });
  const { reserves } = lendingMarkets;
  const connection = new Connection(clusterUrl!.endpoint, 'confirmed');
  const lendingMarketPubKey = new PublicKey(lendingMarkets.address);

  // liquidator's keypair.
  const payer = new Account(JSON.parse(readSecret('keypair')));

  console.log(`
    network: ${process.env.NETWORK}
    clusterUrl: ${clusterUrl!.endpoint}
    wallet: ${payer.publicKey.toBase58()}
  `);

  for (let epoch = 0; ; epoch += 1) {
    const tokensOracle = await getTokensOracleData(connection, reserves);
    const allObligations = await getObligations(connection, lendingMarketPubKey);
    const allReserves = await getReserves(connection, lendingMarketPubKey);

    for (let obligation of allObligations) {
      if (obligation) {
        while (true) {
          const {
            borrowedValue,
            unhealthyBorrowValue,
            deposits,
            borrows,
          } = calculateRefreshedObligation(
            obligation.info,
            obligation.pubkey,
            allReserves,
            tokensOracle,
          );

          // Do nothing if obligation is healthy
          if (borrowedValue.isLessThanOrEqualTo(unhealthyBorrowValue)) {
            break;
          }

          console.log(
            `Obligation ${obligation.pubkey.toString()} is underwater`,
            'borrowedValue: ', borrowedValue.toString(),
            'unhealthyBorrowValue', unhealthyBorrowValue.toString(),
          );

          // select repay token that has the highest market value
          let selectedBorrow;
          borrows.forEach((borrow) => {
            if (!selectedBorrow || borrow.marketValue.gt(selectedBorrow.marketValue)) {
              selectedBorrow = borrow;
            }
          });

          // select the withdrawal collateral token with the highest market value
          let selectedDeposit;
          deposits.forEach((deposit) => {
            if (!selectedDeposit || deposit.marketValue.gt(selectedDeposit.marketValue)) {
              selectedDeposit = deposit;
            }
          });

          if (!selectedBorrow || !selectedDeposit) {
            console.error(
              `Toxic obligation found in ${obligation.pubkey.toString()}, unable to identify repay and withdrawal tokens`,
              selectedBorrow && selectedBorrow.symbol,
              selectedDeposit && selectedDeposit.symbol,
            );
            break;
          }

          // Set super high liquidation amount which acts as u64::MAX as program will only liquidate max
          // 50% val of all borrowed assets.
          try {
            await liquidateObligation(
              connection,
              payer,
              U64_MAX,
              selectedBorrow.symbol,
              selectedDeposit.symbol,
              lendingMarkets,
              obligation,
            );
          } catch (err) {
            console.error(`error liquidating ${obligation.pubkey.toString()}: `, err);
            break;
          }

          const postLiquidationObligation = await connection.getAccountInfo(
            new PublicKey(obligation.pubkey),
          );
          obligation = ObligationParser(obligation.pubkey, postLiquidationObligation!);
        }
      }
    }

    // check if collateral redeeming is required
    const collateralBalances = await getCollateralBalances(connection, payer, reserves);
    collateralBalances.forEach(({ balance, symbol }) => {
      if (balance > 0.001) {
        redeemCollateral(connection, payer, balance.toString(), symbol, lendingMarkets);
      }
    });

    // Throttle to avoid rate limiter
    if (process.env.THROTTLE) {
      await wait(process.env.THROTTLE);
    }
  }
}

runLiquidator();