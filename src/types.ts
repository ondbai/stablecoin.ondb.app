export interface Balance {
  address: string;
  amount: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  type: 'mint' | 'burn' | 'transfer';
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  blockHeight?: number;
}

export interface StablecoinMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  adminAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreResult {
  block_height: number;
  ticket_id?: string;
}
