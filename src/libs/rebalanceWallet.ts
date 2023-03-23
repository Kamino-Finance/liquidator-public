/* eslint-disable no-lonely-if */
/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
import { findWhere } from 'underscore';
import BigNumber from 'bignumber.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TokenCount, TokenInfo } from 'global';
import logger from 'services/logger';
import { Jupiter } from '@jup-ag/core';
import swap from './swap';
import { TokenBalance } from './utils';
import { TokenOracleData } from './oracle';

// Padding so we rebalance only when abs(target-actual)/target is greater than PADDING
const PADDING = Number(process.env.REBALANCE_PADDING) || 0.2;

export async function rebalanceWallet(connection: Connection, payer: Keypair, jupiter: Jupiter, tokensOracle: TokenOracleData[], walletBalances: TokenBalance[], target: TokenCount[]) {
  const info = await aggregateInfo(tokensOracle, walletBalances, connection, payer, target);
  // calculate token diff between current & target value
  info.forEach((tokenInfo) => {
    tokenInfo.diff = tokenInfo.balance - tokenInfo.target;
    tokenInfo.diffUSD = tokenInfo.diff * tokenInfo.price;
  });

  // Sort in decreasing order so we sell first then buy
  info.sort((a, b) => b.diffUSD - a.diffUSD);

  for (const tokenInfo of info) {
    // skip usdc since it is our base currency
    if (tokenInfo.symbol === 'USDC') {
      continue;
    }

    // skip if exchange amount is too little
    if (Math.abs(tokenInfo.diff) <= PADDING * tokenInfo.target) {
      continue;
    }

    let fromTokenInfo;
    let toTokenInfo;
    let amount;

    const USDCTokenInfo = findWhere(info, { symbol: 'USDC' });
    if (!USDCTokenInfo) {
      logger.error('failed to find USDC token info');
    }

    // negative diff means we need to buy
    if (tokenInfo.diff < 0) {
      fromTokenInfo = USDCTokenInfo;
      toTokenInfo = tokenInfo;
      amount = (new BigNumber(tokenInfo.diffUSD).multipliedBy(fromTokenInfo!.decimals)).abs();

      // positive diff means we sell
    } else {
      fromTokenInfo = tokenInfo;
      toTokenInfo = USDCTokenInfo;
      amount = new BigNumber(tokenInfo.diff).multipliedBy(fromTokenInfo.decimals);
    }

    try {
      await swap(connection, payer, jupiter, fromTokenInfo!, toTokenInfo!, Math.floor(amount.toNumber()));
    } catch (error) {
      logger.error(error, 'failed to swap tokens');
    }
  }
}

function aggregateInfo(tokensOracle: TokenOracleData[], walletBalances: TokenBalance[], connection: Connection, wallet: Keypair, target: TokenCount[]) {
  const info: TokenInfo[] = [];
  target.forEach(async (tokenDistribution: TokenCount) => {
    const { symbol, target } = tokenDistribution;
    const tokenOracle = findWhere(tokensOracle, { symbol });
    const walletBalance = findWhere(walletBalances, { symbol });

    if (walletBalance && tokenOracle) {
      // -1 as sentinel value for account not available
      if (walletBalance.balance === -1) {
        const token = new Token(
          connection,
          new PublicKey(tokenOracle.mintAddress),
          TOKEN_PROGRAM_ID,
          wallet,
        );

        // create missing ATA for token
        const ata = await token.createAssociatedTokenAccount(wallet.publicKey);
        walletBalance.ata = ata.toString();
        walletBalance.balance = 0;
      }

      const usdValue = new BigNumber(walletBalance.balance).multipliedBy(tokenOracle.price);
      info.push({
        symbol,
        target,
        mintAddress: tokenOracle.mintAddress,
        ata: walletBalance.ata?.toString(),
        balance: walletBalance.balance,
        usdValue: usdValue.toNumber(),
        price: tokenOracle.price.toNumber(),
        decimals: tokenOracle.decimals.toNumber(),
        reserveAddress: tokenOracle.reserveAddress,
        diff: 0,
        diffUSD: 0,
      });
    }
  });

  return info;
}
