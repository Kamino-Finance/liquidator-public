/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */
import { KaminoMarket } from '@hubbleprotocol/kamino-lending-sdk';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import {
  LiquidityToken, TokenCount,
} from 'global';
import { findWhere } from 'underscore';
import { TokenOracleData } from './oracle';

export const WAD = new BigNumber(`1${''.padEnd(18, '0')}`);
export const U64_MAX = '18446744073709551615';
export const NULL_PUBKEY = 'nu11111111111111111111111111111111111111111';

// Converts amount to human (rebase with decimals)
export function toHuman(market: KaminoMarket, amount: string, symbol: string) {
  const decimals = getDecimals(market, symbol);
  return toHumanDec(amount, decimals);
}

export function toBaseUnit(market: KaminoMarket, amount: string, symbol: string) {
  if (amount === U64_MAX) return amount;
  const decimals = getDecimals(market, symbol);
  return toBaseUnitDec(amount, decimals);
}

// Converts to base unit amount
// e.g. 1.0 SOL => 1000000000 (lamports)
function toBaseUnitDec(amount: string, decimals: number) {
  if (decimals < 0) {
    throw new Error(`Invalid decimal ${decimals}`);
  }
  if ((amount.match(/\./g) || []).length > 1) {
    throw new Error('Too many decimal points');
  }
  let decimalIndex = amount.indexOf('.');
  let precision;
  if (decimalIndex === -1) {
    precision = 0;
    decimalIndex = amount.length; // Pretend it's at the end
  } else {
    precision = amount.length - decimalIndex - 1;
  }
  if (precision === decimals) {
    return amount.slice(0, decimalIndex) + amount.slice(decimalIndex + 1);
  }
  if (precision < decimals) {
    const numTrailingZeros = decimals - precision;
    return (
      amount.slice(0, decimalIndex)
      + amount.slice(decimalIndex + 1)
      + ''.padEnd(numTrailingZeros, '0')
    );
  }
  return (
    amount.slice(0, decimalIndex)
    + amount.slice(decimalIndex + 1, decimalIndex + decimals + 1)
  );
}

function getDecimals(market: KaminoMarket, symbol: string) {
  const tokenInfo = getTokenInfo(market, symbol);
  return tokenInfo.decimals;
}

// Returns token info from config
export function getTokenInfo(market: KaminoMarket, symbol: string) {
  const tokenInfo = findWhere(market.reserves.map((reserve) => reserve.config.liquidityToken), { symbol });
  if (!tokenInfo) {
    throw new Error(`Could not find ${symbol} in config.assets`);
  }
  return tokenInfo;
}

export function getTokenInfoFromMarket(market: KaminoMarket, symbol: string) {
  const liquidityToken: LiquidityToken = findWhere(market.reserves.map((reserve) => reserve.config.liquidityToken), { symbol });
  if (!liquidityToken) {
    throw new Error(`Could not find ${symbol} in config.assets`);
  }
  return {
    symbol: liquidityToken.symbol,
    decimals: liquidityToken.decimals,
    mintAddress: liquidityToken.mint,
  };
}

export function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function toHumanDec(amount: string, decimals: number) {
  let amountStr = amount.slice(amount.length - Math.min(decimals, amount.length));
  if (decimals > amount.length) {
    for (let i = 0; i < decimals - amount.length; i += 1) {
      amountStr = `0${amountStr}`;
    }
    amountStr = `0.${amountStr}`;
  } else {
    amountStr = `.${amountStr}`;
    for (let i = amount.length - decimals - 1; i >= 0; i -= 1) {
      amountStr = amount[i] + amountStr;
    }
  }
  amountStr = stripEnd(amountStr, '0');
  amountStr = stripEnd(amountStr, '.');
  return amountStr;
}

// Strips character c from end of string s
function stripEnd(s: string, c: string) {
  let i = s.length - 1;
  for (; i >= 0; i -= 1) {
    if (s[i] !== c) {
      break;
    }
  }
  return s.slice(0, i + 1);
}

export async function getWalletBalances(connection, wallet, tokensOracle, market) {
  const promises: Promise<any>[] = [];
  for (const [key, value] of Object.entries(tokensOracle)) {
    if (value) {
      const tokenOracleData = value as TokenOracleData;
      promises.push(getWalletTokenData(connection, market, wallet, tokenOracleData.mintAddress, tokenOracleData.symbol));
    }
  }
  const walletBalances = await Promise.all(promises);
  return walletBalances;
}

export async function getWalletTokenData(connection: Connection, market: KaminoMarket, wallet, mintAddress, symbol) {
  const token = new Token(
    connection,
    new PublicKey(mintAddress),
    TOKEN_PROGRAM_ID,
    wallet.publicKey,
  );
  const userTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(mintAddress),
    wallet.publicKey,
  );

  try {
    const result = await token.getAccountInfo(userTokenAccount);
    const balance = toHuman(market, result!.amount.toString(), symbol);
    const balanceBase = result!.amount.toString();

    return {
      balance: Number(balance),
      balanceBase: Number(balanceBase),
      symbol,
    };
  } catch (e) {
    return {
      balance: -1, // sentinel value
      balanceBase: -1, // sentinel value
      symbol,
    };
  }
}

export const findAssociatedTokenAddress = async (
  walletAddress: PublicKey,
  tokenMintAddress: PublicKey,
) => (
  await PublicKey.findProgramAddress(
    [walletAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), tokenMintAddress.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
)[0];

export const getWalletBalance = async (
  connection: Connection,
  mint: PublicKey,
  walletAddress: PublicKey,
): Promise<number> => {
  const userAta = await findAssociatedTokenAddress(walletAddress, mint);

  return connection
    .getTokenAccountBalance(userAta)
    .then((tokenAmount) => {
      if (parseFloat(tokenAmount?.value?.amount)) {
        return parseFloat(tokenAmount.value.amount);
      }
      return 0;
    })
    .catch((error) => 0);
};

export function getWalletDistTarget() {
  const target: TokenCount[] = [];
  const targetRaw = process.env.TARGETS || '';

  if (targetRaw === '') {
    return target;
  }

  const targetDistributions = targetRaw.split(' ');
  for (const dist of targetDistributions) {
    const tokens = dist.split(':');
    const asset = tokens[0];
    const unitAmount = tokens[1];

    target.push({ symbol: asset, target: parseFloat(unitAmount) });
  }

  return target;
}
