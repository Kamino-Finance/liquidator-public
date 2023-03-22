import { parsePriceData } from '@pythnetwork/client';
import SwitchboardProgram from '@switchboard-xyz/sbv2-lite';
import { Connection, PublicKey } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Scope } from '@hubbleprotocol/scope-sdk';
import dotenv from 'dotenv';
import {
  KaminoMarket, KaminoReserve,
} from '@hubbleprotocol/kamino-lending-sdk';
import { SolanaCluster } from '@hubbleprotocol/hubble-config';
import logger from 'services/logger';

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const NULL_ORACLE = 'nu11111111111111111111111111111111111111111';
const SWITCHBOARD_V2_ADDRESS = process.env.APP === 'mainnet-beta' ? 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f' : '2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG';
const SCOPE_ADDRESS = process.env.APP === 'mainnet-beta'
  ? 'HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ'
  : '3Vw8Ngkh1MVJTPHthmUbmU2XKtFEkjYvJzMqrv2rh9yX';

let switchboardV2: SwitchboardProgram | undefined;

export type TokenOracleData = {
  symbol: string;
  reserveAddress: string;
  mintAddress: string;
  decimals: BigNumber;
  price: BigNumber;
};

// TODO: Add freshness of the latest price to mock sc logic
async function getTokenOracleData(connection: Connection, reserve: KaminoReserve) {
  let price: number | undefined = 0;
  const oracle = {
    pythAddress: reserve.config.pythOracle,
    switchboardFeedAddress: reserve.config.switchboardOracle,
    switchboardTwapAddress: reserve.config.switchboardTwapOracle,
    scopeOracleAddress: reserve.config.scopeOracle,
  };

  if (oracle.pythAddress && oracle.pythAddress !== NULL_ORACLE && oracle.pythAddress !== PublicKey.default.toString()) {
    const pythPublicKey = new PublicKey(oracle.pythAddress);
    const result = await connection.getAccountInfo(pythPublicKey);
    try {
      price = parsePriceData(result!.data).price;
    } catch (error) {
      logger.error('Error parsing pyth price data', error);
    }
  } else if (oracle.switchboardFeedAddress && oracle.switchboardFeedAddress !== NULL_ORACLE && oracle.switchboardFeedAddress !== PublicKey.default.toString()) {
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
      logger.error('Unrecognized switchboard owner address: ', owner);
    }
  } else {
    const pricePublicKey = new PublicKey(oracle.scopeOracleAddress);
    const info = await connection.getAccountInfo(pricePublicKey);
    const owner = info?.owner.toString();
    if (owner === SCOPE_ADDRESS) {
      const scope = new Scope(process.env.APP as SolanaCluster, connection);
      const result = await scope.getPriceByMint(reserve.config.liquidityToken.mint);
      price = result?.price.toNumber();
    } else {
      logger.error('Unrecognized scope owner address: ', owner);
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
