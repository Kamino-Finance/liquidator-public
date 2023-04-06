import {
  ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { map } from 'underscore';
import {
  refreshReserve as refreshReserveInstruction, liquidateObligationAndRedeemReserveCollateral, refreshObligation as refreshObligationInstruction, KaminoMarket, KaminoReserve, Obligation,
} from '@hubbleprotocol/kamino-lending-sdk';
import BN from 'bn.js';
import { ObligationCollateral, ObligationLiquidity } from '@hubbleprotocol/kamino-lending-sdk/dist/types';
import logger from 'services/logger';
import { createAddExtraComputeUnitsTransaction } from 'libs/computeBudget';

export const liquidateAndRedeem = async (
  connection: Connection,
  payer: Keypair,
  liquidityAmount: number | string,
  repayTokenSymbol: string,
  withdrawTokenSymbol: string,
  lendingMarket: KaminoMarket,
  obligation: KaminoObligation,
) => {
  const tx = new Transaction();

  const repayReserve = lendingMarket.reserves.find((res) => res.config.liquidityToken.symbol === repayTokenSymbol);
  const withdrawReserve = lendingMarket.reserves.find((res) => res.config.liquidityToken.symbol === withdrawTokenSymbol);

  if (!withdrawReserve || !repayReserve) {
    throw new Error('Reserves are not identified');
  }

  const rewardedWithdrawalCollateralAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(withdrawReserve.config.collateralMint),
    payer.publicKey,
  );
  const rewardedWithdrawalLiquidityAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(withdrawReserve.config.liquidityToken.mint),
    payer.publicKey,
  );

  const preIxs = await createRewardWithdrawalAccounts(connection, payer, withdrawReserve, rewardedWithdrawalLiquidityAccount, rewardedWithdrawalCollateralAccount);
  tx.add(...preIxs);

  const ixs = await getLiquidationInstructions(payer, lendingMarket, obligation, repayReserve, withdrawReserve, rewardedWithdrawalLiquidityAccount, rewardedWithdrawalCollateralAccount, liquidityAmount);

  tx.add(...ixs);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  const simulatedTx = await connection.simulateTransaction(tx);
  logger.info('Simulated tx %o', simulatedTx);

  const txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  logger.info(`Liquidation successful, tx signature, ${txHash.toString()}`);
  await connection.confirmTransaction(txHash, 'processed');

  const rewardedWithdrawCollateralBalanceAfter = await connection.getTokenAccountBalance(rewardedWithdrawalCollateralAccount);
  logger.info(`rewardedCollateralBalance after: ${rewardedWithdrawCollateralBalanceAfter.value.uiAmountString}`);

  const rewardedWithdrawLiquidityBalanceAfter = await connection.getTokenAccountBalance(rewardedWithdrawalLiquidityAccount);
  logger.info(`rewardedLiquidityBalance after: ${rewardedWithdrawLiquidityBalanceAfter.value.uiAmountString}`);
};

export async function createRewardWithdrawalAccounts(
  connection: Connection,
  payer: Keypair,
  withdrawReserve: KaminoReserve,
  rewardedWithdrawalLiquidityAccount: PublicKey,
  rewardedWithdrawalCollateralAccount: PublicKey,
) {
  const ixs: TransactionInstruction[] = [];
  const rewardedWithdrawalCollateralAccountInfo = await connection.getAccountInfo(
    rewardedWithdrawalCollateralAccount,
  );

  if (!rewardedWithdrawalCollateralAccountInfo) {
    const createUserCollateralAccountIx = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new PublicKey(withdrawReserve.config.collateralMint),
      rewardedWithdrawalCollateralAccount,
      payer.publicKey,
      payer.publicKey,
    );
    ixs.push(createUserCollateralAccountIx);
  } else {
    const rewardedWithdrawCollateralBalance = await connection.getTokenAccountBalance(rewardedWithdrawalCollateralAccount);
    logger.info(`rewardedCollateralBalance before: ${rewardedWithdrawCollateralBalance.value.uiAmountString}`);
  }

  const rewardedWithdrawalLiquidityAccountInfo = await connection.getAccountInfo(
    rewardedWithdrawalLiquidityAccount,
  );
  if (!rewardedWithdrawalLiquidityAccountInfo) {
    const createUserCollateralAccountIx = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new PublicKey(withdrawReserve.config.liquidityToken.mint),
      rewardedWithdrawalLiquidityAccount,
      payer.publicKey,
      payer.publicKey,
    );
    ixs.push(createUserCollateralAccountIx);
  } else {
    const rewardedWithdrawLiquidityBalance = await connection.getTokenAccountBalance(rewardedWithdrawalLiquidityAccount);
    logger.info(`rewardedLiquidityBalance before: ${rewardedWithdrawLiquidityBalance.value.uiAmountString}`);
  }

  return ixs;
}

export const getLiquidationInstructions = async (
  payer: Keypair,
  lendingMarket: KaminoMarket,
  obligation: KaminoObligation,
  repayReserve: KaminoReserve,
  withdrawReserve: KaminoReserve,
  rewardedWithdrawalLiquidityAccount: PublicKey,
  rewardedWithdrawalCollateralAccount: PublicKey,
  liquidityAmount: number | string,
): Promise<TransactionInstruction[]> => {
  const ixs: TransactionInstruction[] = [];

  ixs.push(createAddExtraComputeUnitsTransaction(payer.publicKey, 600_000));

  const depositReserves = obligation.info.deposits.filter((deposit: ObligationCollateral) => deposit.depositReserve.toString() !== PublicKey.default.toString()).map((deposit: ObligationCollateral) => deposit.depositReserve);
  const borrowReserves = obligation.info.borrows.filter((borrow: ObligationLiquidity) => borrow.borrowReserve.toString() !== PublicKey.default.toString()).map((borrow: ObligationLiquidity) => borrow.borrowReserve);

  const uniqReserveAddresses = [...new Set<String>(map(depositReserves.concat(borrowReserves), (reserve) => reserve.toString()))];
  uniqReserveAddresses.forEach((reserveAddress) => {
    const kaminoReserve = lendingMarket.reserves.find((res: KaminoReserve) => res.config.address === reserveAddress);
    if (!kaminoReserve) {
      throw new Error(`Missing reserve info for reserve ${reserveAddress}, cannot liquidate.`);
    }

    const refreshReserveIx = refreshReserveInstruction({
      reserve: new PublicKey(reserveAddress),
      pythOracle: new PublicKey(kaminoReserve.config.pythOracle),
      switchboardPriceOracle: new PublicKey(kaminoReserve.config.switchboardOracle),
      switchboardTwapOracle: new PublicKey(kaminoReserve.config.switchboardTwapOracle),
      scopePrices: new PublicKey(kaminoReserve.config.scopeOracle),
    });
    ixs.push(refreshReserveIx);
  });

  const refreshObligationIx = refreshObligationInstruction(
    {
      lendingMarket: new PublicKey(lendingMarket.config.lendingMarket),
      obligation: obligation.pubkey,
      depositReserves,
      borrowReserves,
    },
  );
  ixs.push(refreshObligationIx);

  // get account that will be repaying the reserve liquidity
  const repayAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(repayReserve.config.liquidityToken.mint),
    payer.publicKey,
  );

  ixs.push(
    liquidateObligationAndRedeemReserveCollateral({
      liquidityAmount: new BN(liquidityAmount),
    },
    {
      userSourceLiquidity: repayAccount,
      userDestinationCollateral: rewardedWithdrawalCollateralAccount,
      userDestinationLiquidity: rewardedWithdrawalLiquidityAccount,
      repayReserve: new PublicKey(repayReserve.config.address),
      repayReserveLiquiditySupply: new PublicKey(repayReserve.config.liquiditySupply),
      withdrawReserve: new PublicKey(withdrawReserve.config.address),
      withdrawReserveCollateralMint: new PublicKey(withdrawReserve.config.collateralMint),
      withdrawReserveCollateralSupply: new PublicKey(withdrawReserve.config.collateralSupply),
      withdrawReserveLiquiditySupply: new PublicKey(withdrawReserve.config.liquiditySupply),
      withdrawReserveLiquidityFeeReceiver: new PublicKey(withdrawReserve.config.liquidityFeeReceiver),
      obligation: obligation.pubkey,
      lendingMarket: new PublicKey(lendingMarket.config.lendingMarket),
      lendingMarketAuthority: new PublicKey(lendingMarket.config.lendingMarketAuthority),
      liquidator: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
  );

  return ixs;
};

export type KaminoObligation = {
  pubkey: PublicKey;
  info: Obligation;
};
