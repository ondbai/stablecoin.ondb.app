import { createClient, OnChainDBClient, PaymentRequiredError, X402Quote } from '@onchaindb/sdk';

interface Balance {
  address: string;
  amount: string;
  updatedAt: string;
}

interface Transaction {
  id: string;
  type: 'mint' | 'burn' | 'transfer';
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  blockHeight?: number;
}

interface StablecoinMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  adminAddress: string;
  createdAt: string;
  updatedAt: string;
}

const ENDPOINT = process.env.ONCHAINDB_ENDPOINT || 'https://api.onchaindb.io';
const APP_ID = process.env.ONCHAINDB_APP_ID || '';
const APP_KEY = process.env.ONCHAINDB_APP_KEY || '';
const USER_KEY = process.env.ONCHAINDB_USER_KEY || '';

const STABLECOIN_NAME = process.env.STABLECOIN_NAME || 'VietRSD';
const STABLECOIN_SYMBOL = process.env.STABLECOIN_SYMBOL || 'VRSD';
const STABLECOIN_DECIMALS = parseInt(process.env.STABLECOIN_DECIMALS || '6', 10);

const COLLECTIONS = {
  balances: 'stablecoin_balances',
  transactions: 'stablecoin_transactions',
  metadata: 'stablecoin_metadata',
};

let sdkClient: OnChainDBClient | null = null;

function getClient(): OnChainDBClient {
  if (!sdkClient) {
    sdkClient = createClient({
      endpoint: ENDPOINT,
      appId: APP_ID,
      appKey: APP_KEY,
      userKey: USER_KEY || undefined,
    });
  }
  return sdkClient;
}

function toBigIntAmount(amount: number, decimals: number): string {
  const multiplier = Math.pow(10, decimals);
  return Math.floor(amount * multiplier).toString();
}

function fromBigIntAmount(amount: string, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return parseInt(amount, 10) / multiplier;
}

function addBigInt(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function subtractBigInt(a: string, b: string): string {
  const result = BigInt(a) - BigInt(b);
  if (result < 0n) {
    throw new Error('Insufficient balance');
  }
  return result.toString();
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

async function queryRecords<T>(collection: string, filters?: Record<string, any>, limit?: number): Promise<T[]> {
  const client = getClient();
  try {
    // If no filters, get all records
    if (!filters) {
      const result = await client.query({
        collection,
        limit: limit || 100,
      });
      return (result.records || []) as T[];
    }

    // Use findMany for filtered queries
    const records = await client.findMany<T>(collection, filters, { limit: limit || 100 });
    return records;
  } catch (error) {
    console.error(`Query error for ${collection}:`, error);
    return [];
  }
}

// Get all records and find the latest one by updatedAt timestamp
async function findLatestRecord<T extends { updatedAt?: string }>(
  collection: string,
  filters: Record<string, any>
): Promise<T | null> {
  const client = getClient();
  try {
    // Use queryBuilder directly with explicit collection to work around SDK bug
    console.log(`findLatestRecord: querying ${collection} with filters:`, filters);

    let queryBuilder = client.queryBuilder().collection(collection);

    // Add where conditions for each filter
    for (const [field, value] of Object.entries(filters)) {
      queryBuilder = queryBuilder.whereField(field).equals(value);
    }

    const result = await queryBuilder.selectAll().limit(100).execute();
    const records = (result.records || []) as T[];

    console.log(`findLatestRecord: found ${records?.length || 0} records`);
    if (records && records.length > 0) {
      console.log(`findLatestRecord: ALL records:`, JSON.stringify(records, null, 2));
    }

    if (!records || records.length === 0) {
      return null;
    }

    // Sort by updatedAt descending and return the latest
    const sorted = records.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });

    console.log(`findLatestRecord: returning latest record with updatedAt:`, sorted[0].updatedAt);
    return sorted[0];
  } catch (error) {
    console.error(`FindLatestRecord error for ${collection}:`, error);
    return null;
  }
}

async function findOne<T extends { updatedAt?: string }>(collection: string, filters: Record<string, any>): Promise<T | null> {
  // Use findLatestRecord to get the most recent record for append-only storage
  return findLatestRecord<T>(collection, filters);
}

async function storeRecords<T extends Record<string, any>>(
  collection: string,
  data: T[],
  paymentTxHash?: string
): Promise<{ block_height: number }> {
  const client = getClient();

  // If payment tx hash is provided, create a payment callback that returns it
  const paymentCallback = paymentTxHash
    ? async () => ({
        txHash: paymentTxHash,
        network: 'mocha-4',
        sender: '',
        chainType: 'cosmos' as const,
        paymentMethod: 'native' as const,
      })
    : undefined;

  try {
    const result = await client.store(
      { collection, data },
      paymentCallback
    );

    return { block_height: result.block_height || 0 };
  } catch (error: any) {
    // Check if this is a payment required error
    if (error?.code === 'PAYMENT_REQUIRED' || error?.message?.includes('Payment required')) {
      // Re-throw with proper structure for API to handle
      const paymentError = new Error('Payment required') as any;
      paymentError.code = 'PAYMENT_REQUIRED';
      paymentError.details = error.details || error;
      throw paymentError;
    }
    throw error;
  }
}

async function updateDocument<T extends Record<string, any>>(
  collection: string,
  filter: Record<string, any>,
  update: Partial<T>,
  paymentTxHash?: string
): Promise<{ block_height: number }> {
  const existing = await findOne<T>(collection, filter);
  if (!existing) {
    throw new Error('Document not found');
  }
  const updated = { ...existing, ...update };
  console.log(`updateDocument: ${collection} - storing:`, JSON.stringify(updated, null, 2));
  const result = await storeRecords(collection, [updated], paymentTxHash);
  console.log(`updateDocument: ${collection} - result:`, JSON.stringify(result, null, 2));
  return result;
}

export async function getInfo(): Promise<StablecoinMetadata | null> {
  try {
    return await findOne<StablecoinMetadata>(COLLECTIONS.metadata, { symbol: STABLECOIN_SYMBOL });
  } catch {
    return {
      name: STABLECOIN_NAME,
      symbol: STABLECOIN_SYMBOL,
      decimals: STABLECOIN_DECIMALS,
      totalSupply: '0',
      adminAddress: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function getBalance(address: string): Promise<{ balance: number; rawBalance: string; symbol: string }> {
  // Compute balance from transaction history (append-only approach)
  const transactions = await getHistory();

  let balance = BigInt(0);

  for (const tx of transactions) {
    const amount = BigInt(tx.amount);

    // Credit: mints to this address or transfers to this address
    if ((tx.type === 'mint' && tx.to === address) ||
        (tx.type === 'transfer' && tx.to === address)) {
      balance += amount;
    }

    // Debit: burns from this address or transfers from this address
    if ((tx.type === 'burn' && tx.from === address) ||
        (tx.type === 'transfer' && tx.from === address)) {
      balance -= amount;
    }
  }

  const rawBalance = balance.toString();
  return {
    balance: fromBigIntAmount(rawBalance, STABLECOIN_DECIMALS),
    rawBalance,
    symbol: STABLECOIN_SYMBOL,
  };
}

export async function mint(toAddress: string, amount: number, paymentTxHash?: string): Promise<Transaction> {
  const rawAmount = toBigIntAmount(amount, STABLECOIN_DECIMALS);
  const now = new Date().toISOString();

  // Only store the transaction record - balance computed from transaction history
  const transaction: Transaction = {
    id: generateId(),
    type: 'mint',
    from: 'system',
    to: toAddress,
    amount: rawAmount,
    timestamp: now,
  };

  const result = await storeRecords<Transaction>(COLLECTIONS.transactions, [transaction], paymentTxHash);
  transaction.blockHeight = result.block_height;

  return transaction;
}

export async function burn(fromAddress: string, amount: number, paymentTxHash?: string): Promise<Transaction> {
  const rawAmount = toBigIntAmount(amount, STABLECOIN_DECIMALS);
  const now = new Date().toISOString();

  // Verify sufficient balance before burning (computed from transaction history)
  const { rawBalance } = await getBalance(fromAddress);
  const currentBalance = BigInt(rawBalance);
  const burnAmount = BigInt(rawAmount);

  if (currentBalance < burnAmount) {
    throw new Error(`Insufficient balance. Have ${rawBalance}, trying to burn ${rawAmount}`);
  }

  // Only store the transaction record - balance computed from transaction history
  const transaction: Transaction = {
    id: generateId(),
    type: 'burn',
    from: fromAddress,
    to: 'system',
    amount: rawAmount,
    timestamp: now,
  };

  const result = await storeRecords<Transaction>(COLLECTIONS.transactions, [transaction], paymentTxHash);
  transaction.blockHeight = result.block_height;

  return transaction;
}

export async function transfer(fromAddress: string, toAddress: string, amount: number, paymentTxHash?: string): Promise<Transaction> {
  const rawAmount = toBigIntAmount(amount, STABLECOIN_DECIMALS);
  const now = new Date().toISOString();

  // Verify sufficient balance before transferring (computed from transaction history)
  const { rawBalance } = await getBalance(fromAddress);
  const currentBalance = BigInt(rawBalance);
  const transferAmount = BigInt(rawAmount);

  if (currentBalance < transferAmount) {
    throw new Error(`Insufficient balance. Have ${rawBalance}, trying to transfer ${rawAmount}`);
  }

  // Only store the transaction record - balance computed from transaction history
  const transaction: Transaction = {
    id: generateId(),
    type: 'transfer',
    from: fromAddress,
    to: toAddress,
    amount: rawAmount,
    timestamp: now,
  };

  const result = await storeRecords<Transaction>(COLLECTIONS.transactions, [transaction], paymentTxHash);
  transaction.blockHeight = result.block_height;

  return transaction;
}

export async function getHistory(address?: string): Promise<Transaction[]> {
  const client = getClient();
  try {
    // Use queryBuilder directly with explicit collection to work around SDK bug
    console.log('Fetching transactions from collection:', COLLECTIONS.transactions);
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.transactions)
      .selectAll()
      .limit(100)
      .execute();

    console.log('Query result:', JSON.stringify(result, null, 2));

    let transactions = (result.records || []) as Transaction[];
    console.log('Transactions found:', transactions.length);

    // Filter by address if provided (client-side since $or may not work)
    if (address) {
      transactions = transactions.filter(
        (tx) => tx.from === address || tx.to === address
      );
      console.log('Filtered transactions:', transactions.length);
    }

    // Sort by timestamp descending (newest first)
    transactions.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return bTime - aTime;
    });

    return transactions;
  } catch (error) {
    // Re-throw PaymentRequiredError so API can return quote to frontend
    if (error instanceof PaymentRequiredError) {
      throw error;
    }
    console.error('Error fetching history:', error);
    return [];
  }
}

export { STABLECOIN_SYMBOL, STABLECOIN_DECIMALS };
