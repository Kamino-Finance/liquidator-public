import BigNumber from 'bignumber.js';

export const WAD = new BigNumber(1000000000000000000);

// TODO: Add in sdks
// const INITIAL_COLLATERAL_RATIO = 1;
// const INITIAL_COLLATERAL_RATE = new BigNumber(INITIAL_COLLATERAL_RATIO).multipliedBy(WAD);

// export const getCollateralExchangeRate = (reserve: KaminoReserve): BigNumber => {
//   const totalLiquidity = (new BigNumber(reserve.config.liquidity.availableAmount.toString()).multipliedBy(WAD))
//     .plus(new BigNumber(reserve.liquidity.borrowedAmountWads.toString()));

//   const { collateral } = reserve;
//   let rate;
//   if (collateral.mintTotalSupply.isZero() || totalLiquidity.isZero()) {
//     rate = INITIAL_COLLATERAL_RATE;
//   } else {
//     const { mintTotalSupply } = collateral;
//     rate = (new BigNumber(mintTotalSupply.toString()).multipliedBy(WAD))
//       .dividedBy(new BigNumber(totalLiquidity.toString()));
//   }
//   return rate;
// };
