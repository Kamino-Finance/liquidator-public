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
import {
  getTokenInfoFromMarket,
} from 'libs/utils';
import { findWhere, map } from 'underscore';
import {
  ReserveConfigType, refreshReserve as refreshReserveInstruction, liquidateObligationAndRedeemReserveCollateral, refreshObligation as refreshObligationInstruction, KaminoMarket,
} from '@hubbleprotocol/kamino-lending-sdk';
import BN from 'bn.js';

export const liquidateAndRedeem = async (
  connection: Connection,
  payer: Keypair,
  liquidityAmount: number | string,
  repayTokenSymbol: string,
  withdrawTokenSymbol: string,
  lendingMarket: KaminoMarket,
  obligation: any,
) => {
  const ixs: TransactionInstruction[] = [];

  const depositReserves = map(obligation.info.deposits, (deposit) => deposit.depositReserve);
  const borrowReserves = map(obligation.info.borrows, (borrow) => borrow.borrowReserve);
  const uniqReserveAddresses = [...new Set<String>(map(depositReserves.concat(borrowReserves), (reserve) => reserve.toString()))];
  uniqReserveAddresses.forEach((reserveAddress) => {
    const reserveInfo: ReserveConfigType = findWhere(lendingMarket!.reserves, {
      address: reserveAddress,
    });
    const refreshReserveIx = refreshReserveInstruction({
      reserve: new PublicKey(reserveAddress),
      pythOracle: new PublicKey(reserveInfo.pythOracle),
      switchboardPriceOracle: new PublicKey(reserveInfo.switchboardOracle),
      switchboardTwapOracle: new PublicKey(reserveInfo.switchboardTwapOracle),
      scopePrices: new PublicKey(reserveInfo.scopeOracle),
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

  const repayTokenInfo = getTokenInfoFromMarket(lendingMarket, repayTokenSymbol);

  // get account that will be repaying the reserve liquidity
  const repayAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(repayTokenInfo.mintAddress),
    payer.publicKey,
  );

  const reserveSymbolToReserveMap = new Map<string, ReserveConfigType>(
    lendingMarket.reserves.map((reserve) => [reserve.config.liquidityToken.symbol, reserve.config]),
  );

  const repayReserve: ReserveConfigType | undefined = reserveSymbolToReserveMap.get(repayTokenSymbol);
  const withdrawReserve: ReserveConfigType | undefined = reserveSymbolToReserveMap.get(withdrawTokenSymbol);
  const withdrawTokenInfo = getTokenInfoFromMarket(lendingMarket, withdrawTokenSymbol);

  if (!withdrawReserve || !repayReserve) {
    throw new Error('reserves are not identified');
  }

  const rewardedWithdrawalCollateralAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(withdrawReserve.collateralMint),
    payer.publicKey,
  );
  const rewardedWithdrawalCollateralAccountInfo = await connection.getAccountInfo(
    rewardedWithdrawalCollateralAccount,
  );
  if (!rewardedWithdrawalCollateralAccountInfo) {
    const createUserCollateralAccountIx = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new PublicKey(withdrawReserve.collateralMint),
      rewardedWithdrawalCollateralAccount,
      payer.publicKey,
      payer.publicKey,
    );
    ixs.push(createUserCollateralAccountIx);
  }

  const rewardedWithdrawalLiquidityAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(withdrawTokenInfo.mintAddress),
    payer.publicKey,
  );
  const rewardedWithdrawalLiquidityAccountInfo = await connection.getAccountInfo(
    rewardedWithdrawalLiquidityAccount,
  );
  if (!rewardedWithdrawalLiquidityAccountInfo) {
    const createUserCollateralAccountIx = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new PublicKey(withdrawTokenInfo.mintAddress),
      rewardedWithdrawalLiquidityAccount,
      payer.publicKey,
      payer.publicKey,
    );
    ixs.push(createUserCollateralAccountIx);
  }

  ixs.push(
    liquidateObligationAndRedeemReserveCollateral({
      liquidityAmount: new BN(liquidityAmount),
    },
    {
      userSourceLiquidity: repayAccount,
      userDestinationCollateral: rewardedWithdrawalCollateralAccount,
      userDestinationLiquidity: rewardedWithdrawalLiquidityAccount,
      repayReserve: new PublicKey(repayReserve.address),
      repayReserveLiquiditySupply: new PublicKey(repayReserve.liquiditySupply),
      withdrawReserve: new PublicKey(withdrawReserve.address),
      withdrawReserveCollateralMint: new PublicKey(withdrawReserve.collateralMint),
      withdrawReserveCollateralSupply: new PublicKey(withdrawReserve.collateralSupply),
      withdrawReserveLiquiditySupply: new PublicKey(withdrawReserve.liquiditySupply),
      withdrawReserveLiquidityFeeReceiver: new PublicKey(withdrawReserve.liquidityFeeReceiver),
      obligation: obligation.pubkey,
      lendingMarket: new PublicKey(lendingMarket.config.lendingMarket),
      lendingMarketAuthority: new PublicKey(lendingMarket.config.lendingMarketAuthority),
      liquidator: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
  );

  const tx = new Transaction().add(...ixs);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  const txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(txHash, 'processed');
};
