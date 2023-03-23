export interface LiquidityToken {
  // coingeckoID: string;
  decimals: number;
  // logo: string;
  mint: string;
  // name: string;
  symbol: string;
  // volume24h: string;
}

export interface TokenCount {
  symbol: string,
  target: number,
}

export interface TokenInfo {
  symbol: string;
  target: number;
  mintAddress: string;
  ata: string;
  balance: number;
  usdValue: number;
  price: number;
  decimals: number;
  reserveAddress: string;
  diff: number;
  diffUSD: number;
}
