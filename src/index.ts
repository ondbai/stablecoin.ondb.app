import { stablecoin } from './stablecoin';
import { config, validateConfig } from './config';

async function printUsage(): Promise<void> {
  console.log(`
VietRSD Stablecoin CLI

Usage:
  npm run setup                              - Initialize collections and indexes
  npm run mint -- <address> <amount>         - Mint tokens to address
  npm run burn -- <address> <amount>         - Burn tokens from address
  npm run transfer -- <from> <to> <amount>   - Transfer tokens between addresses
  npm run balance -- <address>               - Get balance of address

Or run directly:
  ts-node src/index.ts setup
  ts-node src/index.ts mint <address> <amount>
  ts-node src/index.ts burn <address> <amount>
  ts-node src/index.ts transfer <from> <to> <amount>
  ts-node src/index.ts balance <address>
  ts-node src/index.ts supply
  ts-node src/index.ts info
  ts-node src/index.ts history [address]
`);
}

async function handleSetup(): Promise<void> {
  await stablecoin.setup();
}

async function handleMint(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: mint <address> <amount>');
    process.exit(1);
  }

  const address = args[0];
  const amount = parseFloat(args[1]);

  if (isNaN(amount) || amount <= 0) {
    console.error('Amount must be a positive number');
    process.exit(1);
  }

  const tx = await stablecoin.mint(address, amount);
  console.log('Transaction:', tx);
}

async function handleBurn(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: burn <address> <amount>');
    process.exit(1);
  }

  const address = args[0];
  const amount = parseFloat(args[1]);

  if (isNaN(amount) || amount <= 0) {
    console.error('Amount must be a positive number');
    process.exit(1);
  }

  const tx = await stablecoin.burn(address, amount);
  console.log('Transaction:', tx);
}

async function handleTransfer(args: string[]): Promise<void> {
  if (args.length < 3) {
    console.error('Usage: transfer <from> <to> <amount>');
    process.exit(1);
  }

  const from = args[0];
  const to = args[1];
  const amount = parseFloat(args[2]);

  if (isNaN(amount) || amount <= 0) {
    console.error('Amount must be a positive number');
    process.exit(1);
  }

  const tx = await stablecoin.transfer(from, to, amount);
  console.log('Transaction:', tx);
}

async function handleBalance(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error('Usage: balance <address>');
    process.exit(1);
  }

  const address = args[0];
  const balance = await stablecoin.getBalance(address);
  const rawBalance = await stablecoin.getBalanceRaw(address);

  console.log(`Address: ${address}`);
  console.log(`Balance: ${balance} ${config.stablecoin.symbol}`);
  console.log(`Raw Balance: ${rawBalance} (${config.stablecoin.decimals} decimals)`);
}

async function handleSupply(): Promise<void> {
  const supply = await stablecoin.getTotalSupply();
  console.log(`Total Supply: ${supply} ${config.stablecoin.symbol}`);
}

async function handleInfo(): Promise<void> {
  const metadata = await stablecoin.getMetadata();

  if (!metadata) {
    console.log('Stablecoin not initialized. Run setup first.');
    return;
  }

  console.log('Stablecoin Info:');
  console.log(`  Name: ${metadata.name}`);
  console.log(`  Symbol: ${metadata.symbol}`);
  console.log(`  Decimals: ${metadata.decimals}`);
  console.log(`  Total Supply: ${parseInt(metadata.totalSupply, 10) / Math.pow(10, metadata.decimals)}`);
  console.log(`  Admin: ${metadata.adminAddress}`);
  console.log(`  Created: ${metadata.createdAt}`);
  console.log(`  Updated: ${metadata.updatedAt}`);
}

async function handleHistory(args: string[]): Promise<void> {
  const address = args[0];
  const transactions = await stablecoin.getTransactionHistory(address);

  if (transactions.length === 0) {
    console.log('No transactions found');
    return;
  }

  console.log(`Transaction History${address ? ` for ${address}` : ''}:`);
  for (const tx of transactions) {
    const amount = parseInt(tx.amount, 10) / Math.pow(10, config.stablecoin.decimals);
    console.log(`  [${tx.timestamp}] ${tx.type.toUpperCase()}: ${tx.from} -> ${tx.to}: ${amount} ${config.stablecoin.symbol}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command) {
    await printUsage();
    return;
  }

  try {
    validateConfig();
  } catch (e) {
    console.error('Configuration error:', (e as Error).message);
    console.error('Please copy .env.example to .env and fill in your OnChainDB credentials');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'setup':
        await handleSetup();
        break;
      case 'mint':
        await handleMint(commandArgs);
        break;
      case 'burn':
        await handleBurn(commandArgs);
        break;
      case 'transfer':
        await handleTransfer(commandArgs);
        break;
      case 'balance':
        await handleBalance(commandArgs);
        break;
      case 'supply':
        await handleSupply();
        break;
      case 'info':
        await handleInfo();
        break;
      case 'history':
        await handleHistory(commandArgs);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        await printUsage();
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', (e as Error).message);
    process.exit(1);
  }
}

main();
