import { Account, Connection } from '@solana/web3.js';
import { checkAndUnwrapKaminoTokens } from './kamino/unwrapKamino';

export const unwrapTokens = async (
  connection: Connection,
  payer: Account,
) => {
  await checkAndUnwrapKaminoTokens(connection, payer);
};
