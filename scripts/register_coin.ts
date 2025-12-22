#!/usr/bin/env tsx

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Account } from "@aptos-labs/ts-sdk";
import { readFileSync, existsSync } from "fs";
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

const APTOS_COIN_MODULE = "0x1::managed_coin";
const APTOS_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
const APTOS_COIN_STORE_TYPE = "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>";

interface TestAccount {
  address: string;
  privateKey: string;
  publicKey: string;
}

interface TestAccountsFile {
  created: string;
  network: string;
  accounts: TestAccount[];
}

/**
 * Check if account is registered for AptosCoin
 */
async function isAccountRegistered(address: string): Promise<boolean> {
  try {
    await aptos.getAccountResource<{ coin: { value: string } }>({
      accountAddress: address,
      resourceType: APTOS_COIN_STORE_TYPE,
    });
    return true;
  } catch (error: any) {
    const errorMessage = error?.message || error?.statusCode || "";
    if (
      error?.statusCode === 404 ||
      errorMessage.includes("RESOURCE_DOES_NOT_EXIST") ||
      errorMessage.includes("not found") ||
      errorMessage.includes("AccountResourceNotFound")
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Register a single account for AptosCoin
 */
async function registerAccountForCoin(account: TestAccount): Promise<void> {
  const address = account.address.startsWith("0x") ? account.address : `0x${account.address}`;
  
  console.log(`\n📝 Registering account: ${address}`);

  // Check if already registered
  const isRegistered = await isAccountRegistered(address);
  if (isRegistered) {
    console.log(`  ✅ Already registered for AptosCoin`);
    return;
  }

  try {
    // Extract private key (remove "ed25519-priv-" prefix if present)
    const privateKeyHex = account.privateKey.replace("ed25519-priv-", "");
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    const accountObj = Account.fromPrivateKey({ privateKey });

    const transaction = await aptos.transaction.build.simple({
      sender: accountObj.accountAddress,
      data: {
        function: `${APTOS_COIN_MODULE}::register`,
        typeArguments: [APTOS_COIN_TYPE],
        functionArguments: [],
      },
    });

    console.log("  🔐 Signing transaction...");
    const senderAuthenticator = aptos.transaction.sign({
      signer: accountObj,
      transaction,
    });

    console.log("  📡 Submitting transaction...");
    const pendingTxn = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    });

    console.log(`  ⏳ Transaction submitted: ${pendingTxn.hash}`);
    console.log(`  🔗 View on explorer: https://testnet.movementnetwork.xyz/txn/${pendingTxn.hash}`);

    console.log("  ⏳ Waiting for confirmation...");
    const executedTxn = await aptos.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });

    if (executedTxn.success) {
      console.log(`  ✅ Account registered successfully for AptosCoin!`);
    } else {
      console.error("  ❌ Transaction failed:", executedTxn.vm_status);
      throw new Error(`Transaction failed: ${executedTxn.vm_status}`);
    }
  } catch (error: any) {
    console.error(`  ❌ Error registering account: ${error.message}`);
    throw error;
  }
}

/**
 * Register accounts from test_accounts.json
 */
async function registerAccountsFromFile(): Promise<void> {
  const testAccountsPath = join(process.cwd(), "test_accounts.json");

  if (!existsSync(testAccountsPath)) {
    console.error(`❌ Error: test_accounts.json not found at ${testAccountsPath}`);
    console.error("💡 Create test accounts first using: npm run create-accounts");
    process.exit(1);
  }

  const testAccountsContent = readFileSync(testAccountsPath, "utf-8");
  const testAccountsData: TestAccountsFile = JSON.parse(testAccountsContent);

  console.log(`\n📋 Found ${testAccountsData.accounts.length} account(s) in test_accounts.json`);
  console.log(`Network: ${restUrl}\n`);

  const args = process.argv.slice(2);
  let accountsToRegister: TestAccount[] = [];

  // If addresses provided as arguments, register only those
  if (args.length > 0) {
    const addresses = args.map(addr => addr.startsWith("0x") ? addr : `0x${addr}`);
    accountsToRegister = testAccountsData.accounts.filter(acc => {
      const accAddress = acc.address.startsWith("0x") ? acc.address : `0x${acc.address}`;
      return addresses.includes(accAddress);
    });

    if (accountsToRegister.length === 0) {
      console.error("❌ No matching accounts found in test_accounts.json");
      console.error("Provided addresses:", addresses);
      process.exit(1);
    }

    console.log(`🎯 Registering ${accountsToRegister.length} specified account(s)...`);
  } else {
    // Register all accounts
    accountsToRegister = testAccountsData.accounts;
    console.log(`🔄 Registering all ${accountsToRegister.length} account(s)...`);
  }

  const results = {
    success: 0,
    failed: 0,
    alreadyRegistered: 0,
  };

  for (let i = 0; i < accountsToRegister.length; i++) {
    const account = accountsToRegister[i];
    try {
      const isRegistered = await isAccountRegistered(account.address);
      if (isRegistered) {
        results.alreadyRegistered++;
        console.log(`\n[${i + 1}/${accountsToRegister.length}] ${account.address} - Already registered`);
        continue;
      }

      await registerAccountForCoin(account);
      results.success++;
    } catch (error: any) {
      results.failed++;
      console.error(`\n[${i + 1}/${accountsToRegister.length}] Failed to register ${account.address}`);
    }

    // Small delay between accounts
    if (i < accountsToRegister.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 REGISTRATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`✅ Successfully registered: ${results.success}`);
  console.log(`ℹ️  Already registered: ${results.alreadyRegistered}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log("=".repeat(80) + "\n");
}

// Main execution
registerAccountsFromFile().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
