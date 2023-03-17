import BigNumber from 'bignumber.js';
import { findWhere, find } from 'underscore';
import {
  WAD,
} from 'models/layouts/reserve';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { KaminoReserve, Obligation } from '@hubbleprotocol/kamino-lending-sdk';
import { ObligationCollateral, ObligationLiquidity, U192 } from '@hubbleprotocol/kamino-lending-sdk/dist/types';
import { TokenOracleData } from './pyth';
import { NULL_PUBKEY } from './utils';

export const RISKY_OBLIGATION_THRESHOLD = 78;

// This function doesn't actually refresh the obligation within the blockchain
// but does offchain calculation which mimics the actual refreshObligation instruction
// to optimize of transaction fees.
export function calculateRefreshedObligation(
  obligation: Obligation,
  reserves: KaminoReserve[],
  tokensOracle: TokenOracleData[],
) {
  let depositedValue = new BigNumber(0);
  let borrowedValue = new BigNumber(0);
  let allowedBorrowValue = new BigNumber(0);
  let unhealthyBorrowValue = new BigNumber(0);
  const deposits = [] as Deposit[];
  const borrows = [] as Borrow[];

  obligation.deposits.filter((deposit: ObligationCollateral) => deposit.depositReserve.toBase58() !== PublicKey.default.toBase58() && deposit.depositReserve.toString() !== NULL_PUBKEY).forEach((deposit: ObligationCollateral) => {
    const tokenOracle = findWhere(tokensOracle, { reserveAddress: deposit.depositReserve.toString() });
    if (!tokenOracle) {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw `Missing token info for reserve ${deposit.depositReserve.toString()}, skipping this obligation. Please restart liquidator to fetch latest configs from /v1/config`;
    }
    const { price, decimals, symbol } = tokenOracle;
    const reserve: KaminoReserve = find(reserves, (r: KaminoReserve) => r.config.address.toString() === deposit.depositReserve.toString());
    const { cTokenExchangeRate, loanToValueRatio, liquidationThreshold } = reserve.stats!;
    const marketValue = new BigNumber(deposit.depositedAmount.toString())
      .multipliedBy(WAD)
      .dividedBy(cTokenExchangeRate)
      .multipliedBy(price)
      .dividedBy(decimals);

    depositedValue = depositedValue.plus(marketValue);
    allowedBorrowValue = allowedBorrowValue.plus(marketValue.multipliedBy(loanToValueRatio));
    unhealthyBorrowValue = unhealthyBorrowValue.plus(marketValue.multipliedBy(liquidationThreshold));

    deposits.push({
      depositReserve: deposit.depositReserve,
      depositAmount: deposit.depositedAmount,
      marketValue,
      symbol,
    });
  });

  obligation.borrows.filter((borrow: ObligationLiquidity) => borrow.borrowReserve.toBase58() !== PublicKey.default.toBase58() && borrow.borrowReserve.toBase58() !== NULL_PUBKEY).forEach((borrow: ObligationLiquidity) => {
    const borrowAmountWads = new BigNumber(borrow.borrowedAmountWads.toString());
    const tokenOracle = findWhere(tokensOracle,
      { reserveAddress: borrow.borrowReserve.toString() });
    if (!tokenOracle) {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw `Missing token info for reserve ${borrow.borrowReserve.toString()}, skipping this obligation. Please restart liquidator to fetch latest config from /v1/config.`;
    }
    const {
      price, decimals, symbol, mintAddress,
    } = tokenOracle;
    const reserve: KaminoReserve = find(reserves, (r: KaminoReserve) => r.config.address.toString() === borrow.borrowReserve.toString());
    const cumulativeBorrowRateWadsObligation = u192ToBN(borrow.cumulativeBorrowRateWads);
    const borrowAmountWadsWithInterest = getBorrrowedAmountWadsWithInterest(
      new BigNumber(reserve!.stats!.cumulativeBorrowRateWads.toString()),
      new BigNumber(cumulativeBorrowRateWadsObligation.toString()),
      borrowAmountWads,
    );

    const marketValue = borrowAmountWadsWithInterest
      .multipliedBy(price)
      .dividedBy(decimals);

    borrowedValue = borrowedValue.plus(marketValue);

    borrows.push({
      borrowReserve: borrow.borrowReserve,
      borrowAmountWads: borrow.borrowedAmountWads,
      mintAddress,
      marketValue,
      symbol,
    });
  });

  let utilizationRatio = borrowedValue.dividedBy(depositedValue).multipliedBy(100).toNumber();
  utilizationRatio = Number.isNaN(utilizationRatio) ? 0 : utilizationRatio;

  return {
    depositedValue,
    borrowedValue,
    allowedBorrowValue,
    unhealthyBorrowValue,
    deposits,
    borrows,
    utilizationRatio,
  };
}

function getBorrrowedAmountWadsWithInterest(
  reserveCumulativeBorrowRateWads: BigNumber,
  obligationCumulativeBorrowRateWads: BigNumber,
  obligationBorrowAmountWads: BigNumber,
) {
  switch (reserveCumulativeBorrowRateWads.comparedTo(obligationCumulativeBorrowRateWads)) {
    case -1: {
      // less than
      console.error(`Interest rate cannot be negative.
        reserveCumulativeBorrowRateWadsNum: ${reserveCumulativeBorrowRateWads.toString()} |
        obligationCumulativeBorrowRateWadsNum: ${obligationCumulativeBorrowRateWads.toString()}`);
      return obligationBorrowAmountWads;
    }
    case 0: {
      // do nothing when equal
      return obligationBorrowAmountWads;
    }
    case 1: {
      // greater than
      const compoundInterestRate = reserveCumulativeBorrowRateWads.dividedBy(obligationCumulativeBorrowRateWads);
      return obligationBorrowAmountWads.multipliedBy(compoundInterestRate);
    }
    default: {
      console.log(`Error: getBorrrowedAmountWadsWithInterest() identified invalid comparator.
      reserveCumulativeBorrowRateWadsNum: ${reserveCumulativeBorrowRateWads.toString()} |
      obligationCumulativeBorrowRateWadsNum: ${obligationCumulativeBorrowRateWads.toString()}`);
      return obligationBorrowAmountWads;
    }
  }
}

type Borrow = {
  borrowReserve: PublicKey;
  borrowAmountWads: BN;
  marketValue: BigNumber;
  mintAddress: string,
  symbol: string;
};

type Deposit = {
  depositReserve: PublicKey,
  depositAmount: BN,
  marketValue: BigNumber,
  symbol: string;
};

function u192ToBN(u192: U192): BN {
  const [a, b, c] = u192.value;
  const shift64 = new BN(2).pow(new BN(64));
  const shift128 = shift64.pow(new BN(2));
  const high = a.add(b.mul(shift64)).add(c.mul(shift128));
  return high;
}
