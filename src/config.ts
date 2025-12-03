import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  endpoint: process.env.ONCHAINDB_ENDPOINT || 'https://api.onchaindb.io',
  appId: process.env.ONCHAINDB_APP_ID || '',
  appKey: process.env.ONCHAINDB_APP_KEY || '',
  userKey: process.env.ONCHAINDB_USER_KEY || '',

  stablecoin: {
    name: process.env.STABLECOIN_NAME || 'VietRSD',
    symbol: process.env.STABLECOIN_SYMBOL || 'VRSD',
    decimals: parseInt(process.env.STABLECOIN_DECIMALS || '6', 10),
  },

  adminAddress: process.env.ADMIN_ADDRESS || '',

  collections: {
    balances: 'stablecoin_balances',
    transactions: 'stablecoin_transactions',
    metadata: 'stablecoin_metadata',
  },
};

export function validateConfig(): void {
  if (!config.appId) {
    throw new Error('ONCHAINDB_APP_ID is required');
  }
  if (!config.appKey) {
    throw new Error('ONCHAINDB_APP_KEY is required');
  }
}
