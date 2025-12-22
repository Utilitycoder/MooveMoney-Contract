#!/usr/bin/env tsx

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Account, AccountAddress } from "@aptos-labs/ts-sdk";
import { readFileSync, writeFileSync } from "fs";
import { parse } from "yaml";
import { join } from "path";

// Read Movement config
const configPath = join(process.cwd(), ".movement", "config.yaml");
const configContent = readFileSync(configPath, "utf-8");
const config = parse(configContent);

const defaultProfile = config.profiles.default;
const restUrl = defaultProfile.rest_url;
const faucetUrl = defaultProfile.faucet_url;

// Initialize Aptos client
const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: restUrl,
  faucet: faucetUrl,
});
const aptos = new Aptos(aptosConfig);

const APTOS_COIN_MODULE = "0x1::managed_coin";
const APTOS_COIN_TYPE = "0x1::aptos_coin::AptosCoin";

interface TestAccount {
  address: string;
  privateKey: string;
  publicKey: string;
}

/**
 * Create a new test account
 */
function createTestAccount(): TestAccount {
  const account = Account.generate();
  return {
    address: account.accountAddress.toString(),
    privateKey: account.privateKey.toString(),
    publicKey: account.publicKey.toString(),
  };
}

/**
 * Check if account exists on-chain
 */
async function accountExists(address: string): Promise<boolean> {
  try {
    await aptos.getAccountInfo({ accountAddress: address });
    return true;
  } catch (error: any) {
    return false;
  }
}

/**
 * Wait for account to be created on-chain
 */
async function waitForAccountCreation(address: string, maxRetries: number = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    if (await accountExists(address)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between checks
  }
  throw new Error(`Account ${address} was not created on-chain after ${maxRetries} seconds`);
}

/**
 * Fund account from faucet
 */
async function fundAccount(address: string): Promise<string | null> {
  try {
    console.log(`  💰 Funding account from faucet...`);
    const accountAddress = AccountAddress.fromString(address);
    
    // Use the SDK's fundAccount method which handles the faucet request properly
    const result = await aptos.fundAccount({
      accountAddress,
      amount: 100_000_000, // 1 MOVE in octas
    });
    
    const txHash = result?.hash || null;
    
    if (txHash) {
      console.log(`  ⏳ Waiting for funding transaction to confirm...`);
      try {
        await aptos.waitForTransaction({ transactionHash: txHash });
        console.log(`  ✅ Funded successfully (tx: ${txHash})`);
      } catch (error: any) {
        console.log(`  ⚠️  Transaction submitted but confirmation failed: ${error.message}`);
      }
    } else {
      console.log(`  ✅ Funding request submitted`);
    }
    
    // Wait for account to be created on-chain
    console.log(`  ⏳ Waiting for account to be created on-chain...`);
    await waitForAccountCreation(address);
    console.log(`  ✅ Account created on-chain`);
    
    return txHash;
  } catch (error: any) {
    console.error(`  ⚠️  SDK fundAccount failed: ${error.message}`);
    // If SDK method fails, try fallback to direct faucet call
    console.log(`  🔄 Trying fallback faucet method...`);
    return await fundAccountFallback(address);
  }
}

/**
 * Fallback method to fund account using direct faucet API call
 */
async function fundAccountFallback(address: string): Promise<string | null> {
  try {
    // Try GET request first (some faucets use GET)
    let response: Response = await fetch(`${faucetUrl}?address=${address}&amount=100000000`, {
      method: "GET",
    });

    // If GET fails, try POST
    if (!response.ok) {
      response = await fetch(faucetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: address,
          amount: 100000000,
        }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Faucet request failed: ${response.status} - ${errorText}`);
    }

    const result: any = await response.json();
    const txHash: string | null = result?.hash || result?.[0]?.hash || result?.txn_hashes?.[0] || null;
    
    if (txHash) {
      console.log(`  ⏳ Waiting for funding transaction to confirm...`);
      try {
        await aptos.waitForTransaction({ transactionHash: txHash });
        console.log(`  ✅ Funded successfully (tx: ${txHash})`);
      } catch (error: any) {
        console.log(`  ⚠️  Transaction submitted but confirmation failed: ${error.message}`);
      }
    }
    
    // Wait for account to be created on-chain
    console.log(`  ⏳ Waiting for account to be created on-chain...`);
    await waitForAccountCreation(address);
    console.log(`  ✅ Account created on-chain`);
    
    return txHash;
  } catch (error: any) {
    throw new Error(`Fallback funding also failed: ${error.message}`);
  }
}

/**
 * Register account for AptosCoin
 */
async function registerAccountForCoin(privateKey: string): Promise<void> {
  try {
    console.log(`  📝 Registering for AptosCoin...`);
    const account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(privateKey) });

    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: `${APTOS_COIN_MODULE}::register`,
        typeArguments: [APTOS_COIN_TYPE],
        functionArguments: [],
      },
    });

    const senderAuthenticator = aptos.transaction.sign({
      signer: account,
      transaction,
    });

    const pendingTxn = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    });

    await aptos.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });

    console.log(`  ✅ Registered successfully`);
  } catch (error: any) {
    console.error(`  ⚠️  Failed to register: ${error.message}`);
    throw error;
  }
}

/**
 * Create test accounts
 */
async function createTestAccounts(
  count: number,
  options: {
    fund?: boolean;
    register?: boolean;
    saveToFile?: boolean;
  } = {}
): Promise<TestAccount[]> {
  const { fund = true, register = true, saveToFile = true } = options;

  console.log(`\n🔨 Creating ${count} test account(s)...`);
  console.log(`Network: ${restUrl}`);
  console.log(`Faucet: ${faucetUrl}\n`);

  const accounts: TestAccount[] = [];

  for (let i = 0; i < count; i++) {
    console.log(`\n[${i + 1}/${count}] Creating account...`);
    
    const account = createTestAccount();
    accounts.push(account);

    console.log(`  📍 Address: ${account.address}`);
    console.log(`  🔑 Private Key: ${account.privateKey}`);
    console.log(`  🔓 Public Key: ${account.publicKey}`);

    if (fund) {
      try {
        await fundAccount(account.address);
      } catch (error: any) {
        console.error(`  ❌ Failed to fund account ${i + 1}: ${error.message}`);
        // Skip registration if funding failed
        continue;
      }
    }

    if (register) {
      try {
        // Ensure account exists before registering
        if (!(await accountExists(account.address))) {
          console.log(`  ⏳ Account not yet on-chain, waiting...`);
          await waitForAccountCreation(account.address);
        }
        await registerAccountForCoin(account.privateKey);
      } catch (error: any) {
        console.error(`  ❌ Failed to register account ${i + 1}: ${error.message}`);
        // Continue with other accounts even if one fails
      }
    }

    // Small delay between accounts to avoid rate limiting
    if (i < count - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Save to file
  if (saveToFile) {
    const accountsFile = join(process.cwd(), "test_accounts.json");
    const accountsData = {
      created: new Date().toISOString(),
      network: restUrl,
      accounts: accounts.map(acc => ({
        address: acc.address,
        privateKey: acc.privateKey,
        publicKey: acc.publicKey,
      })),
    };

    writeFileSync(accountsFile, JSON.stringify(accountsData, null, 2));
    console.log(`\n💾 Accounts saved to: ${accountsFile}`);
  }

  return accounts;
}

/**
 * Display accounts in a format easy to copy
 */
function displayAccounts(accounts: TestAccount[]): void {
  console.log("\n" + "=".repeat(80));
  console.log("📋 TEST ACCOUNTS SUMMARY");
  console.log("=".repeat(80));
  
  accounts.forEach((account, index) => {
    console.log(`\nAccount ${index + 1}:`);
    console.log(`  Address:    ${account.address}`);
    console.log(`  Private Key: ${account.privateKey}`);
    console.log(`  Public Key:  ${account.publicKey}`);
  });

  console.log("\n" + "=".repeat(80));
  console.log("💡 Usage Examples:");
  console.log("=".repeat(80));
  console.log("\nSend MOVE tokens to these accounts:");
  const addresses = accounts.map(acc => acc.address).join(" ");
  const amounts = accounts.map(() => "100000000").join(" ");
  console.log(`  npm run send ${addresses} ${amounts}`);
  
  console.log("\nOr use individual addresses:");
  accounts.forEach((account, index) => {
    console.log(`  Account ${index + 1}: ${account.address}`);
  });
  console.log("\n");
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const count = args[0] ? parseInt(args[0], 10) : 2;

  if (isNaN(count) || count < 1 || count > 10) {
    console.error("Usage: npm run create-accounts [count]");
    console.error("  count: Number of accounts to create (1-10, default: 2)");
    process.exit(1);
  }

  try {
    const accounts = await createTestAccounts(count, {
      fund: true,
      register: true,
      saveToFile: true,
    });

    displayAccounts(accounts);

    console.log("✅ All accounts created successfully!");
  } catch (error: any) {
    console.error("\n❌ Error creating accounts:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

