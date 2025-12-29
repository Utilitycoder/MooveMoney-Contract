#!/usr/bin/env tsx

import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { join } from "path";

// Read Movement config
const configPath = join(process.cwd(), ".movement", "config.yaml");
const configContent = readFileSync(configPath, "utf-8");
const config = parse(configContent);

const defaultProfile = config.profiles.default;
const restUrl = defaultProfile.rest_url;

// Initialize Aptos client
const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: restUrl,
});
const aptos = new Aptos(aptosConfig);

/**
 * Format timestamp to readable date
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(parseInt(timestamp) / 1000);
  return date.toLocaleString();
}

/**
 * Format amount from octas to MOVE
 */
function formatAmount(amount: string | number): string {
  const numAmount = typeof amount === "string" ? BigInt(amount) : BigInt(amount);
  const moveAmount = Number(numAmount) / 100_000_000;
  return moveAmount.toFixed(8);
}

/**
 * Format transaction type for display
 */
function formatTransactionType(txn: any): string {
  if (txn.type === "user_transaction") {
    if (txn.payload?.function) {
      return `Function: ${txn.payload.function}`;
    }
    return "User Transaction";
  }
  return txn.type || "Unknown";
}

/**
 * Get timestamp from transaction (handles different transaction response formats)
 */
function getTransactionTimestamp(txn: any): number {
  const timestamp = txn.timestamp || txn.transaction?.timestamp;
  if (!timestamp) {
    // If no timestamp, use version as fallback (higher version = newer)
    const version = txn.version || txn.transaction?.version;
    return version ? Number(version) : 0;
  }
  return parseInt(timestamp, 10);
}

/**
 * Sort transactions by timestamp (newest first)
 */
function sortTransactionsByNewest(transactions: any[]): any[] {
  return [...transactions].sort((a, b) => {
    const timestampA = getTransactionTimestamp(a);
    const timestampB = getTransactionTimestamp(b);
    // Sort descending (newest first)
    return timestampB - timestampA;
  });
}

/**
 * Display transaction details in a formatted way
 */
function displayTransaction(txn: any, index: number, total: number): void {
  console.log("\n" + "=".repeat(80));
  console.log(`Transaction ${index + 1} of ${total}`);
  console.log("=".repeat(80));
  
  const hash = txn.hash || txn.transaction?.hash || "N/A";
  const version = txn.version || txn.transaction?.version || "N/A";
  const timestamp = txn.timestamp || txn.transaction?.timestamp;
  const success = txn.success !== undefined ? txn.success : (txn.transaction?.success !== undefined ? txn.transaction.success : true);
  
  console.log(`\n📋 Transaction Hash: ${hash}`);
  console.log(`📅 Timestamp: ${timestamp ? formatTimestamp(timestamp) : "N/A"}`);
  console.log(`🔄 Type: ${formatTransactionType(txn)}`);
  console.log(`✅ Status: ${success ? "✅ Success" : "❌ Failed"}`);
  
  const sender = txn.sender || txn.transaction?.sender;
  if (sender) {
    console.log(`👤 Sender: ${sender}`);
  }
  
  if (version !== "N/A") {
    console.log(`🔢 Version: ${version}`);
  }
  
  // Display gas information
//   const gasUsed = txn.gas_used || txn.transaction?.gas_used;
//   const gasUnitPrice = txn.gas_unit_price || txn.transaction?.gas_unit_price;
  
//   if (gasUsed) {
//     console.log(`⛽ Gas Used: ${gasUsed}`);
//   }
  
//   if (gasUnitPrice) {
//     console.log(`💰 Gas Unit Price: ${gasUnitPrice}`);
//   }
  
//   // Display payload details if available
//   const payload = txn.payload || txn.transaction?.payload;
//   if (payload) {
//     console.log(`\n📦 Payload Details:`);
//     if (payload.function) {
//       console.log(`   Function: ${payload.function}`);
//     }
//     if (payload.type_arguments) {
//       console.log(`   Type Arguments: ${JSON.stringify(payload.type_arguments)}`);
//     }
//     if (payload.arguments) {
//       console.log(`   Arguments: ${JSON.stringify(payload.arguments, null, 2)}`);
//     }
//   }
  
//   // Display events if available
//   const events = txn.events || txn.transaction?.events;
//   if (events && events.length > 0) {
//     console.log(`\n📢 Events (${events.length}):`);
//     events.forEach((event: any, idx: number) => {
//       console.log(`   ${idx + 1}. Type: ${event.type || event.key}`);
//       if (event.data) {
//         console.log(`      Data: ${JSON.stringify(event.data, null, 6)}`);
//       }
//     });
//   }
  
//   // Display changes if available
//   const changes = txn.changes || txn.transaction?.changes;
//   if (changes && changes.length > 0) {
//     console.log(`\n🔄 Resource Changes (${changes.length}):`);
//     changes.forEach((change: any, idx: number) => {
//       console.log(`   ${idx + 1}. Type: ${change.type}`);
//       if (change.data) {
//         // Format coin store changes nicely
//         if (change.data.coin?.value) {
//           const amount = formatAmount(change.data.coin.value);
//           console.log(`      Coin Amount: ${amount} MOVE`);
//         }
//         console.log(`      Data: ${JSON.stringify(change.data, null, 6)}`);
//       }
//     });
//   }
  
//   // Display VM status if transaction failed
//   const vmStatus = txn.vm_status || txn.transaction?.vm_status;
//   if (!success && vmStatus) {
//     console.log(`\n❌ VM Status: ${vmStatus}`);
//   }
}

/**
 * Fetch and display transaction history for an account
 */
async function getTransactionHistory(
  accountAddress: string,
  options: {
    limit?: number;
  } = {}
): Promise<void> {
  const address = accountAddress.startsWith("0x") ? accountAddress : `0x${accountAddress}`;
  const limit = options.limit || 10;

  console.log(`\n🔍 Fetching transaction history for account: ${address}`);
  console.log(`📊 Limit: ${limit}\n`);

  try {
    // Get account transactions
    const transactions = await aptos.getAccountTransactions({
      accountAddress: address,
      options: {
        limit,
      },
    });

    if (transactions.length === 0) {
      console.log("📭 No transactions found for this account.");
      return;
    }

    // Sort transactions by timestamp (newest first)
    // The SDK may return them in descending order by default, but we'll ensure it
    const sortedTransactions = sortTransactionsByNewest(transactions);

    console.log(`\n✅ Found ${sortedTransactions.length} transaction(s)\n`);

    // Display each transaction (newest first)
    sortedTransactions.forEach((txn, index) => {
      displayTransaction(txn, index, sortedTransactions.length);
    });

    // Display summary
    console.log("\n" + "=".repeat(80));
    console.log("📊 Summary");
    console.log("=".repeat(80));
    console.log(`Total Transactions: ${sortedTransactions.length}`);
    
    // Check success status - need to check if it's a user transaction with success field
    let successful = 0;
    let failed = 0;
    sortedTransactions.forEach((txn: any) => {
      if (txn.type === "user_transaction") {
        // For user transactions, check the success field if available
        if (txn.success === false) {
          failed++;
        } else {
          successful++;
        }
      } else {
        // For other transaction types, assume successful
        successful++;
      }
    });
    
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);

    // Show pagination info if there are more transactions
    if (sortedTransactions.length === limit) {
      console.log(`\n💡 Note: Showing first ${limit} transactions. Use --limit to see more.`);
    }
  } catch (error: any) {
    console.error("❌ Error fetching transaction history:", error.message);
    if (error.message?.includes("Account not found")) {
      console.error("💡 The account address might be invalid or the account has no transactions.");
    }
    throw error;
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse command line arguments
  let accountAddress: string | null = null;
  let limit = 10;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" || arg === "-l") {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit) || limit <= 0) {
        console.error("❌ Invalid limit value. Must be a positive number.");
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
📖 Usage: tsx scripts/get_transaction_history.ts [options] [account_address]

Options:
  --limit, -l <number>    Number of transactions to fetch (default: 10)
  --help, -h              Show this help message

Examples:
  # Get last 10 transactions for default account
  tsx scripts/get_transaction_history.ts

  # Get last 20 transactions for a specific account
  tsx scripts/get_transaction_history.ts --limit 20 0x123...

  # Get transactions for default account with custom limit
  tsx scripts/get_transaction_history.ts --limit 5
      `);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      accountAddress = arg;
    }
  }

  // If no account address provided, use the default account from config
  if (!accountAddress) {
    accountAddress = defaultProfile.account;
    console.log(`ℹ️  No account address provided, using default account from config: ${accountAddress}`);
  }

  // Ensure accountAddress is not null (TypeScript guard)
  if (!accountAddress) {
    console.error("❌ Error: No account address provided and no default account found in config.");
    process.exit(1);
  }

  await getTransactionHistory(accountAddress, { limit });
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

