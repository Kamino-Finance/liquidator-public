/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */
import { KaminoMarket } from '@hubbleprotocol/kamino-lending-sdk';
import { sleep } from '@hubbleprotocol/kamino-sdk/dist/utils';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token, NATIVE_MINT,
} from '@solana/spl-token';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import {
  LiquidityToken, TokenCount,
} from 'global';
import logger from 'services/logger';
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
  const liquidityToken: LiquidityToken | undefined = findWhere(market.reserves.map((reserve) => reserve.config.liquidityToken), { symbol });
  if (!liquidityToken) {
    throw new Error(`Could not find ${symbol} in config.assets`);
  }
  return liquidityToken;
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

export async function getWalletBalances(connection: Connection, wallet: Keypair, tokensOracle: TokenOracleData[], market: KaminoMarket) {
  const walletBalances: TokenBalance[] = [];
  for (const [, value] of Object.entries(tokensOracle)) {
    if (value) {
      const tokenOracleData = value as TokenOracleData;
      const tokenBalance = await getWalletTokenData(connection, market, wallet, tokenOracleData.mintAddress, tokenOracleData.symbol);
      walletBalances.push(tokenBalance);
    }
  }

  return walletBalances;
}

export async function getWalletTokenData(connection: Connection, market: KaminoMarket, wallet: any, mintAddress: string, symbol: string): Promise<TokenBalance> {
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

  const tokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
  try {
    if (tokenAccountInfo === null) {
      const createAtaIx = await Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(mintAddress),
        userTokenAccount,
        wallet.publicKey,
        wallet.publicKey,
      );

      const tx = new Transaction().add(createAtaIx);
      const signature = await connection.sendTransaction(tx, [wallet]);
      confirmTx(connection, signature);
      await sleep(3000);
    }

    if (symbol === 'SOL') {
      const wsolBalance = await token.getAccountInfo(userTokenAccount);
      if (wsolBalance?.amount.toNumber() === 0) {
        const solBalance = await connection.getBalance(wallet.publicKey);
        await createWSOLAccount(connection, wallet, Math.ceil(solBalance / 2));
      }
    }
    const newResult = await token.getAccountInfo(userTokenAccount);
    const balance = toHuman(market, newResult!.amount.toString(), symbol);
    const balanceBase = newResult!.amount.toString();
    return {
      balance: Number(balance),
      balanceBase: Number(balanceBase),
      symbol,
      ata: userTokenAccount.toBase58(),
    };
  } catch (e) {
    logger.error(`Error ${e}, tokenAccountCreation failed for ${symbol}`);
    return {
      balance: -1,
      balanceBase: -1,
      symbol,
      ata: '',
    };
  }
}

export const findAssociatedTokenAddress = async (
  walletAddress: PublicKey,
  tokenMintAddress: PublicKey,
) => (
  await PublicKey.findProgramAddressSync(
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

export async function confirmTx(connection: Connection, txHash: string) {
  const blockhashInfo = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    signature: txHash,
  });
}

export type TokenBalance = {
  symbol: string;
  balance: number;
  balanceBase: number;
  ata: string;
};

export async function createWSOLAccountInstrs(
  connection: Connection,
  owner: PublicKey,
  amount: number,
): Promise<[TransactionInstruction[], PublicKey]> {
  const toAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    NATIVE_MINT,
    owner,
  );
  const info = await connection.getAccountInfo(toAccount);
  const instructions: TransactionInstruction[] = [];

  if (info === null) {
    instructions.push(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        NATIVE_MINT,
        toAccount,
        owner,
        owner,
      ),
    );
  }

  // Fund account and sync
  if (amount > 0) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: toAccount,
        lamports: amount,
      }),
    );
  }
  instructions.push(
    // Sync Native instruction. @solana/spl-token will release it soon. Here use the raw instruction temporally.
    new TransactionInstruction({
      keys: [
        {
          pubkey: toAccount,
          isSigner: false,
          isWritable: true,
        },
      ],
      data: Buffer.from(new Uint8Array([17])),
      programId: TOKEN_PROGRAM_ID,
    }),
  );

  return [instructions, toAccount];
}

export async function createWSOLAccount(
  connection: Connection,
  payer: Keypair,
  amount: number,
): Promise<PublicKey> {
  const tx = new Transaction();
  const [ixs, wsolAddress] = await createWSOLAccountInstrs(connection, payer.publicKey, amount);

  tx.add(...ixs);
  const txHash = await connection.sendTransaction(tx, [payer]);
  confirmTx(connection, txHash);

  return wsolAddress;
}
