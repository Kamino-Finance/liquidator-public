import { Connection, Keypair } from '@solana/web3.js';
import { checkAndUnwrapKaminoTokens } from './kamino/unwrapKamino';

export const unwrapTokens = async (
  connection: Connection,
  payer: Keypair,
) => {
  await checkAndUnwrapKaminoTokens(connection, payer);
};
