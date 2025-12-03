import * as db from './client';
import { config } from './config';
import { Balance, Transaction, StablecoinMetadata } from './types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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

export class Stablecoin {
  private decimals: number;

  constructor() {
    this.decimals = config.stablecoin.decimals;
  }

  async setup(): Promise<void> {
    console.log('Setting up stablecoin collections and indexes...');

    try {
      await db.createIndex({
        name: 'idx_balances_address',
        collection: config.collections.balances,
        field_name: 'address',
        index_type: 'hash',
        options: { unique: true },
      });
      console.log('Created balances address index');
    } catch (e) {
      console.log('Balances index may already exist:', (e as Error).message);
    }

    try {
      await db.createIndex({
        name: 'idx_transactions_id',
        collection: config.collections.transactions,
        field_name: 'id',
        index_type: 'hash',
        options: { unique: true },
      });
      console.log('Created transactions id index');
    } catch (e) {
      console.log('Transactions index may already exist:', (e as Error).message);
    }

    try {
      await db.createIndex({
        name: 'idx_transactions_timestamp',
        collection: config.collections.transactions,
        field_name: 'timestamp',
        index_type: 'btree',
      });
      console.log('Created transactions timestamp index');
    } catch (e) {
      console.log('Transactions timestamp index may already exist:', (e as Error).message);
    }

    try {
      await db.createIndex({
        name: 'idx_metadata_symbol',
        collection: config.collections.metadata,
        field_name: 'symbol',
        index_type: 'hash',
        options: { unique: true },
      });
      console.log('Created metadata symbol index');
    } catch (e) {
      console.log('Metadata index may already exist:', (e as Error).message);
    }

    const existingMetadata = await db.findOne<StablecoinMetadata>(
      config.collections.metadata,
      { symbol: config.stablecoin.symbol }
    );

    if (!existingMetadata) {
      const metadata: StablecoinMetadata = {
        name: config.stablecoin.name,
        symbol: config.stablecoin.symbol,
        decimals: config.stablecoin.decimals,
        totalSupply: '0',
        adminAddress: config.adminAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.store(config.collections.metadata, [metadata]);
      console.log('Created stablecoin metadata');
    } else {
      console.log('Stablecoin metadata already exists');
    }

    console.log('Setup complete!');
  }

  async mint(toAddress: string, amount: number): Promise<Transaction> {
    const rawAmount = toBigIntAmount(amount, this.decimals);
    const now = new Date().toISOString();

    const balance = await db.findOne<Balance>(config.collections.balances, {
      address: toAddress,
    });

    if (balance) {
      const newAmount = addBigInt(balance.amount, rawAmount);
      await db.updateDocument<Balance>(
        config.collections.balances,
        { address: toAddress },
        { amount: newAmount, updatedAt: now }
      );
    } else {
      const newBalance: Balance = {
        address: toAddress,
        amount: rawAmount,
        updatedAt: now,
      };
      await db.store(config.collections.balances, [newBalance]);
    }

    const metadata = await db.findOne<StablecoinMetadata>(
      config.collections.metadata,
      { symbol: config.stablecoin.symbol }
    );

    if (metadata) {
      const newSupply = addBigInt(metadata.totalSupply, rawAmount);
      await db.updateDocument<StablecoinMetadata>(
        config.collections.metadata,
        { symbol: config.stablecoin.symbol },
        { totalSupply: newSupply, updatedAt: now }
      );
    }

    const transaction: Transaction = {
      id: generateId(),
      type: 'mint',
      from: 'system',
      to: toAddress,
      amount: rawAmount,
      timestamp: now,
    };

    const result = await db.store(config.collections.transactions, [transaction]);
    transaction.blockHeight = result.block_height;

    console.log(`Minted ${amount} ${config.stablecoin.symbol} to ${toAddress}`);
    return transaction;
  }

  async burn(fromAddress: string, amount: number): Promise<Transaction> {
    const rawAmount = toBigIntAmount(amount, this.decimals);
    const now = new Date().toISOString();

    const balance = await db.findOne<Balance>(config.collections.balances, {
      address: fromAddress,
    });

    if (!balance) {
      throw new Error(`No balance found for address ${fromAddress}`);
    }

    const newAmount = subtractBigInt(balance.amount, rawAmount);

    await db.updateDocument<Balance>(
      config.collections.balances,
      { address: fromAddress },
      { amount: newAmount, updatedAt: now }
    );

    const metadata = await db.findOne<StablecoinMetadata>(
      config.collections.metadata,
      { symbol: config.stablecoin.symbol }
    );

    if (metadata) {
      const newSupply = subtractBigInt(metadata.totalSupply, rawAmount);
      await db.updateDocument<StablecoinMetadata>(
        config.collections.metadata,
        { symbol: config.stablecoin.symbol },
        { totalSupply: newSupply, updatedAt: now }
      );
    }

    const transaction: Transaction = {
      id: generateId(),
      type: 'burn',
      from: fromAddress,
      to: 'system',
      amount: rawAmount,
      timestamp: now,
    };

    const result = await db.store(config.collections.transactions, [transaction]);
    transaction.blockHeight = result.block_height;

    console.log(`Burned ${amount} ${config.stablecoin.symbol} from ${fromAddress}`);
    return transaction;
  }

  async transfer(fromAddress: string, toAddress: string, amount: number): Promise<Transaction> {
    const rawAmount = toBigIntAmount(amount, this.decimals);
    const now = new Date().toISOString();

    const fromBalance = await db.findOne<Balance>(config.collections.balances, {
      address: fromAddress,
    });

    if (!fromBalance) {
      throw new Error(`No balance found for address ${fromAddress}`);
    }

    const newFromAmount = subtractBigInt(fromBalance.amount, rawAmount);

    await db.updateDocument<Balance>(
      config.collections.balances,
      { address: fromAddress },
      { amount: newFromAmount, updatedAt: now }
    );

    const toBalance = await db.findOne<Balance>(config.collections.balances, {
      address: toAddress,
    });

    if (toBalance) {
      const newToAmount = addBigInt(toBalance.amount, rawAmount);
      await db.updateDocument<Balance>(
        config.collections.balances,
        { address: toAddress },
        { amount: newToAmount, updatedAt: now }
      );
    } else {
      const newBalance: Balance = {
        address: toAddress,
        amount: rawAmount,
        updatedAt: now,
      };
      await db.store(config.collections.balances, [newBalance]);
    }

    const transaction: Transaction = {
      id: generateId(),
      type: 'transfer',
      from: fromAddress,
      to: toAddress,
      amount: rawAmount,
      timestamp: now,
    };

    const result = await db.store(config.collections.transactions, [transaction]);
    transaction.blockHeight = result.block_height;

    console.log(
      `Transferred ${amount} ${config.stablecoin.symbol} from ${fromAddress} to ${toAddress}`
    );
    return transaction;
  }

  async getBalance(address: string): Promise<number> {
    const balance = await db.findOne<Balance>(config.collections.balances, {
      address,
    });

    if (!balance) {
      return 0;
    }

    return fromBigIntAmount(balance.amount, this.decimals);
  }

  async getBalanceRaw(address: string): Promise<string> {
    const balance = await db.findOne<Balance>(config.collections.balances, {
      address,
    });

    return balance?.amount || '0';
  }

  async getTotalSupply(): Promise<number> {
    const metadata = await db.findOne<StablecoinMetadata>(
      config.collections.metadata,
      { symbol: config.stablecoin.symbol }
    );

    if (!metadata) {
      return 0;
    }

    return fromBigIntAmount(metadata.totalSupply, this.decimals);
  }

  async getMetadata(): Promise<StablecoinMetadata | null> {
    return db.findOne<StablecoinMetadata>(config.collections.metadata, {
      symbol: config.stablecoin.symbol,
    });
  }

  async getTransactionHistory(address?: string, limit: number = 50): Promise<Transaction[]> {
    const filters = address ? { $or: [{ from: address }, { to: address }] } : undefined;
    return db.query<Transaction>(config.collections.transactions, filters, limit);
  }
}

export const stablecoin = new Stablecoin();
