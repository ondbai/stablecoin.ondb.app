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

export interface Quote {
  type: 'quote';
  broker_address: string;
  total_cost_tia: string;
  total_cost_utia: number;
}

export interface StoreResult {
  block_height: number;
  ticket_id?: string;
}

export interface PaymentProof {
  txHash: string;
  network: string;
}
