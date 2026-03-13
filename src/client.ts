import { createClient, OnDBClient, StoreResponse } from '@onchaindb/sdk';
import { config } from './config';
import { StoreResult } from './types';

let sdkClient: OnDBClient | null = null;

function getClient(): OnDBClient {
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
  let qb = client.queryBuilder().collection(collection);

  if (filters) {
    for (const [field, value] of Object.entries(filters)) {
      if (field === '$or' || field.startsWith('$')) {
        continue; // Skip complex operators, handle client-side
      }
      qb = qb.whereField(field).equals(value);
    }
  }

  if (limit) {
    qb = qb.limit(limit);
  }

  const result = await qb.selectAll().execute();
  return (result.records || []) as T[];
}

export async function findOne<T extends Record<string, any>>(
  collection: string,
  filters: Record<string, any>
): Promise<T | null> {
  const client = getClient();
  let qb = client.queryBuilder().collection(collection);

  for (const [field, value] of Object.entries(filters)) {
    qb = qb.whereField(field).equals(value);
  }

  const result = await qb.selectAll().limit(1).execute();
  const records = (result.records || []) as T[];
  return records.length > 0 ? records[0] : null;
}

export async function updateDocument<T extends Record<string, any>>(
  collection: string,
  filter: Record<string, any>,
  update: Partial<T>
): Promise<StoreResult> {
  const existing = await findOne<T>(collection, filter);
  if (!existing) {
    throw new Error('Document not found');
  }
  const updated = { ...existing, ...update };
  return store(collection, [updated]);
}

// Export for direct SDK access if needed
export { getClient };
