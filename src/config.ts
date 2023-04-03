/* eslint-disable no-loop-func */
import got from 'got';
import dotenv from 'dotenv';
import { MarketConfigType } from '@hubbleprotocol/kamino-lending-sdk';
import logger from 'services/logger';

dotenv.config({ path: `.env.${process.env.CLUSTER}` });

const eligibleApps = ['mainnet-beta', 'devnet'];

function getApp() {
  const app = process.env.CLUSTER;
  if (!eligibleApps.includes(app!)) {
    throw new Error(
      `Unrecognized env app provided: ${app}. Must be mainnet-beta or devnet`,
    );
  }
  return app;
}

function getMarketsUrl(): string {
  // Only fetch the targeted markets if specified. Otherwise we fetch all kamino-lending markets

  const api = process.env.MARKET
    ? `https://api.kamino.finance//kamino-market/${process.env.MARKET}` : 'https://api.kamino.finance/kamino-market';

  if (getApp() === 'mainnet-beta') {
    return api;
  }
  return `${api}?env=devnet`;
}

export async function getMarkets(): Promise<MarketConfigType[]> {
  let attemptCount = 0;
  let backoffFactor = 1;
  const maxAttempt = 10;
  const marketUrl = getMarketsUrl();

  do {
    try {
      if (attemptCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffFactor * 10));
        backoffFactor *= 2;
      }
      attemptCount += 1;
      const resp = await got(marketUrl, { json: true });
      const data = resp.body as MarketConfigType[];
      return data;
    } catch (error) {
      logger.error('Error fetching /kamino-market from API', error);
    }
  } while (attemptCount < maxAttempt);

  throw new Error('failed to fetch /kamino-market');
}

export const network = getApp();
