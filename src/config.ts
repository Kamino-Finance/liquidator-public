/* eslint-disable no-loop-func */
import got from 'got';
import { MarketConfig } from 'global';
import dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

export const OBLIGATION_LEN = 1300;
export const RESERVE_LEN = 619;
export const LENDING_MARKET_LEN = 290;
const eligibleApps = ['production', 'devnet'];

function getApp() {
  const app = process.env.APP;
  if (!eligibleApps.includes(app!)) {
    throw new Error(
      `Unrecognized env app provided: ${app}. Must be production or devnet`,
    );
  }
  return app;
}

function getMarketsUrl(): string {
  // Only fetch the targeted markets if specified. Otherwise we fetch all solend pools
  // TODO: Add the specific market endpoint in the api
  if (process.env.MARKET) {
    return `https://api.solend.fi/v1/markets/configs?ids=${process.env.MARKET}`;
  }

  if (getApp() === 'production') {
    return 'https://api.hubbleprotocol.io/kamino-market';
  }
  return 'https://api.hubbleprotocol.io/kamino-market/?env=devnet';
}

export async function getMarkets(): Promise<MarketConfig[]> {
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
      const data = resp.body as MarketConfig[];
      return data;
    } catch (error) {
      console.error('error fetching /kamino-market ', error);
    }
  } while (attemptCount < maxAttempt);

  throw new Error('failed to fetch /kamino-market');
}

export const network = getApp();
