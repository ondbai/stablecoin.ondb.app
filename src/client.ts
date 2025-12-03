import { createClient, OnChainDBClient, StoreResponse, PaymentRequiredError, X402Quote } from '@onchaindb/sdk';
import { config } from './config';
import { StoreResult } from './types';

let sdkClient: OnChainDBClient | null = null;

function getClient(): OnChainDBClient {
  if (!sdkClient) {
    sdkClient = createClient({
      endpoint: config.endpoint,
      appId: config.appId,
      appKey: config.appKey,
      userKey: config.userKey || undefined,
    });
  }
  return sdkClient;
}

export async function createIndex(options: {
  name: string;
  collection: string;
  field_name: string;
  index_type: 'hash' | 'btree' | 'price';
  options?: { unique?: boolean };
}): Promise<void> {
  const client = getClient();
  const db = client.database(config.appId);
  await db.createIndex({
    name: options.name,
    collection: options.collection,
    field_name: options.field_name,
    index_type: options.index_type,
    options: options.options,
  });
}

export async function store<T extends Record<string, any>>(
  collection: string,
  data: T[],
  waitForConfirmation: boolean = true
): Promise<StoreResult> {
  const client = getClient();
  const result: StoreResponse = await client.store(
    {
      collection,
      data,
    },
    undefined,
    waitForConfirmation
  );
  return {
    block_height: result.block_height || 0,
    ticket_id: (result as any).ticket_id,
  };
}

export async function query<T extends Record<string, any>>(
  collection: string,
  filters?: Record<string, any>,
  limit?: number
): Promise<T[]> {
  const client = getClient();
  const result = await client.query({
    collection,
    filters,
    limit,
  });
  return (result.records || []) as T[];
}

export async function findOne<T extends Record<string, any>>(
  collection: string,
  filters: Record<string, any>
): Promise<T | null> {
  const client = getClient();
  const result = await client.findUnique<T>(collection, filters);
  return result;
}

export async function findMany<T extends Record<string, any>>(
  collection: string,
  filters: Record<string, any> = {},
  options: { limit?: number; offset?: number } = {}
): Promise<T[]> {
  const client = getClient();
  return client.findMany<T>(collection, filters, options);
}

export async function updateDocument<T extends Record<string, any>>(
  collection: string,
  filter: Record<string, any>,
  update: Partial<T>
): Promise<StoreResult> {
  // For updates, we need to fetch, modify, and re-store
  const existing = await findOne<T>(collection, filter);
  if (!existing) {
    throw new Error('Document not found');
  }
  const updated = { ...existing, ...update };
  return store(collection, [updated]);
}

export async function countDocuments(
  collection: string,
  filters: Record<string, any> = {}
): Promise<number> {
  const client = getClient();
  return client.countDocuments(collection, filters);
}

// Export for direct SDK access if needed
export { getClient };
