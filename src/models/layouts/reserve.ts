import BigNumber from 'bignumber.js';
import { Reserve } from '@hubbleprotocol/kamino-lending-sdk';

export const WAD = new BigNumber(1000000000000000000);

const INITIAL_COLLATERAL_RATIO = 1;
const INITIAL_COLLATERAL_RATE = new BigNumber(INITIAL_COLLATERAL_RATIO).multipliedBy(WAD);

export const getCollateralExchangeRate = (reserve: Reserve): BigNumber => {
  const totalLiquidity = (new BigNumber(reserve.liquidity.availableAmount.toString()).multipliedBy(WAD))
    .plus(new BigNumber(reserve.liquidity.borrowedAmountWads.toString()));

  const { collateral } = reserve;
  let rate;
  if (collateral.mintTotalSupply.isZero() || totalLiquidity.isZero()) {
    rate = INITIAL_COLLATERAL_RATE;
  } else {
    const { mintTotalSupply } = collateral;
    rate = (new BigNumber(mintTotalSupply.toString()).multipliedBy(WAD))
      .dividedBy(new BigNumber(totalLiquidity.toString()));
  }
  return rate;
};

export const getLoanToValueRate = (reserve: Reserve): BigNumber => new BigNumber(
  reserve.config.loanToValueRatio / 100,
);

export const getLiquidationThresholdRate = (reserve: Reserve): BigNumber => new BigNumber(
  reserve.config.liquidationThreshold / 100,
);
