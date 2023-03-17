import { parsePriceData } from '@pythnetwork/client';
import SwitchboardProgram from '@switchboard-xyz/sbv2-lite';
import { Connection, PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';

import dotenv from 'dotenv';
import {
  KaminoMarket, KaminoReserve,
} from '@hubbleprotocol/kamino-lending-sdk';

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const NULL_ORACLE = 'nu11111111111111111111111111111111111111111';
const SWITCHBOARD_V2_ADDRESS = process.env.APP === 'mainnet-beta' ? 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f' : '2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG';

let switchboardV2: SwitchboardProgram | undefined;

export type TokenOracleData = {
  symbol: string;
  reserveAddress: string;
  mintAddress: string;
  decimals: BigNumber;
  price: BigNumber;
};

async function getTokenOracleData(connection: Connection, reserve: KaminoReserve) {
  let price: number | undefined = 0;
  const oracle = {
    pythAddress: reserve.config.pythOracle,
    switchboardFeedAddress: reserve.config.switchboardOracle,
    scopeOracleAddress: reserve.config.scopeOracle,
  };

  if (oracle.pythAddress && oracle.pythAddress !== NULL_ORACLE && oracle.pythAddress !== PublicKey.default.toString()) {
    const pythPublicKey = new PublicKey(oracle.pythAddress);
    const result = await connection.getAccountInfo(pythPublicKey);
    price = parsePriceData(result!.data).price;
  } else {
    const pricePublicKey = new PublicKey(oracle.switchboardFeedAddress);
    const info = await connection.getAccountInfo(pricePublicKey);
    const owner = info?.owner.toString();
    if (owner === SWITCHBOARD_V2_ADDRESS) {
      if (!switchboardV2) {
        switchboardV2 = process.env.APP === 'mainnet-beta' ? await SwitchboardProgram.loadMainnet(connection) : await SwitchboardProgram.loadDevnet(connection);
      }
      const result = switchboardV2.decodeLatestAggregatorValue(info!);
      price = result?.toNumber();
    } else {
      console.error('unrecognized switchboard owner address: ', owner);
    }
  }

  return {
    symbol: reserve.config.liquidityToken.symbol,
    reserveAddress: reserve.config.address,
    mintAddress: reserve.config.liquidityToken.mint,
    decimals: new BigNumber(10 ** reserve.config.liquidityToken.decimals),
    price: new BigNumber(price!),
  } as TokenOracleData;
}

export async function getTokensOracleData(connection: Connection, market: KaminoMarket) {
  const promises: Promise<any>[] = market.reserves.map((reserve) => getTokenOracleData(connection, reserve));
  return Promise.all(promises);
}
