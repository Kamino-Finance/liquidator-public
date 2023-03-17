import { KaminoMarket, Obligation } from '@hubbleprotocol/kamino-lending-sdk';
import { Connection } from '@solana/web3.js';

export async function getAllObligationsForMarket(market: KaminoMarket, connection: Connection) {
  const obligations = await connection.getProgramAccounts(
    market.programId,
    {
      filters: [
        {
          dataSize: Obligation.layout.span + 8,
        },
        {
          memcmp: {
            offset: 32,
            bytes: market.config.lendingMarket,
          },
        },
      ],
    },
  );

  return obligations.map((obligation) => {
    if (obligation.account == null) {
      throw new Error('Invalid account');
    }
    if (!obligation.account.owner.equals(market.programId)) {
      throw new Error("account doesn't belong to this program");
    }

    const obligationAccount = Obligation.decode(obligation.account.data);

    if (!obligationAccount) {
      throw Error('Could not parse obligation.');
    }

    return { obligation: obligationAccount, obligationAddress: obligation.pubkey };
  });
}
