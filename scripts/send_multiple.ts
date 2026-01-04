#!/usr/bin/env tsx

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Account, U64 } from "@aptos-labs/ts-sdk";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { join } from "path";

// Read Movement config
const configPath = join(process.cwd(), ".movement", "config.yaml");
const configContent = readFileSync(configPath, "utf-8");
const config = parse(configContent);

const defaultProfile = config.profiles.default;
// const privateKeyHex = defaultProfile.private_key.replace("ed25519-priv-", "");
const accountAddress = defaultProfile.account;
const restUrl = defaultProfile.rest_url;

const new_key = "ed25519-priv-0x058ab1cd10bfd53b2c5feaf298082bb8044743b0bff1fe6e9f98db33b69cd085"

// Initialize Aptos client
const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: restUrl,
});
const aptos = new Aptos(aptosConfig);

// Create account from private key
const privateKey = new Ed25519PrivateKey(new_key);
const account = Account.fromPrivateKey({ privateKey });

// Module information
const MODULE_ADDRESS = accountAddress.startsWith("0x") ? accountAddress : `0x${accountAddress}`;
const MODULE_NAME = "moove_money";
const FUNCTION_NAME = "send_move_to_multiple";

// AptosCoin type address (0x1::aptos_coin::AptosCoin)
const APTOS_COIN_MODULE = "0x1::managed_coin";
const APTOS_COIN_STORE_TYPE = "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>";
const APTOS_COIN_TYPE = "0x1::aptos_coin::AptosCoin";

/**
 * Check if an account is registered for AptosCoin
 */
async function isAccountRegisteredForCoin(accountAddress: string): Promise<boolean> {
  try {
    const address = accountAddress.startsWith("0x") ? accountAddress : `0x${accountAddress}`;
    
    // Try to get the coin store resource
    await aptos.getAccountResource<{ coin: { value: string } }>({
      accountAddress: address,
      resourceType: APTOS_COIN_STORE_TYPE,
    });
    
    return true;
  } catch (error: any) {
    // If resource doesn't exist, account is not registered
    const errorMessage = error?.message || error?.statusCode || "";
    if (
      error?.statusCode === 404 ||
      errorMessage.includes("RESOURCE_DOES_NOT_EXIST") ||
      errorMessage.includes("not found") ||
      errorMessage.includes("AccountResourceNotFound")
    ) {
      return false;
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Register sender account for AptosCoin if not already registered
 */
async function ensureSenderRegistered(): Promise<void> {
  const isRegistered = await isAccountRegisteredForCoin(account.accountAddress.toString());
  
  if (!isRegistered) {
    console.log("📝 Sender account not registered for AptosCoin. Registering...");
    
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

    console.log(`⏳ Registration transaction submitted: ${pendingTxn.hash}`);
    
    await aptos.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });
    
    console.log("✅ Sender account registered successfully!\n");
  }
}

/**
 * Send MOVE tokens to multiple recipients
 * @param recipients Array of recipient addresses (as hex strings)
 * @param amounts Array of amounts to send (in octas, 1 MOVE = 10^8 octas)
 */
async function sendMoveToMultiple(
  recipients: string[],
  amounts: number[]
): Promise<void> {
  console.log(`\n📤 Sending MOVE tokens to ${recipients.length} recipients...`);
  console.log(`Sender: ${account.accountAddress.toString()}`);
  console.log(`Network: ${restUrl}\n`);

  // Validate inputs
  if (recipients.length !== amounts.length) {
    throw new Error("Recipients and amounts arrays must have the same length");
  }

  if (recipients.length === 0) {
    throw new Error("At least one recipient is required");
  }

  // Display transfer details
  console.log("Transfer details:");
  recipients.forEach((recipient, index) => {
    const amountInMove = amounts[index] / 100_000_000; // Convert octas to MOVE
    console.log(`  → ${recipient}: ${amountInMove} MOVE (${amounts[index]} octas)`);
  });

  // Ensure sender is registered
  await ensureSenderRegistered();

  // Check recipient registration status
  console.log("\n🔍 Checking recipient registration status...");
  const unregisteredRecipients: string[] = [];
  
  for (const recipient of recipients) {
    const normalizedRecipient = recipient.startsWith("0x") ? recipient : `0x${recipient}`;
    const isRegistered = await isAccountRegisteredForCoin(normalizedRecipient);
    
    if (!isRegistered) {
      unregisteredRecipients.push(normalizedRecipient);
      console.log(`  ❌ ${normalizedRecipient} - NOT REGISTERED`);
    } else {
      console.log(`  ✅ ${normalizedRecipient} - Registered`);
    }
  }

  if (unregisteredRecipients.length > 0) {
    console.error("\n❌ Error: The following recipient accounts are not registered for AptosCoin:");
    unregisteredRecipients.forEach(addr => console.error(`   - ${addr}`));
    console.error("\n💡 Recipients must register for AptosCoin before they can receive MOVE tokens.");
    console.error("   They can register by calling: 0x1::managed_coin::register<0x1::aptos_coin::AptosCoin>()");
    console.error("   Or use: npm run register-coin (if they have access to this project)");
    throw new Error(`${unregisteredRecipients.length} recipient(s) not registered for AptosCoin`);
  }

  // Check sender balance
  try {
    const balance = await aptos.getAccountAPTAmount({ accountAddress: account.accountAddress });
    const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0);
    console.log(`\n💰 Sender balance: ${balance / 100_000_000} MOVE`);
    console.log(`💸 Total to send: ${totalAmount / 100_000_000} MOVE`);

    if (balance < totalAmount) {
      throw new Error(`Insufficient balance. Need ${totalAmount / 100_000_000} MOVE but have ${balance / 100_000_000} MOVE`);
    }
  } catch (error) {
    console.warn("⚠️  Could not check balance:", error);
  }

  // Prepare transaction
  const transaction = await aptos.transaction.build.simple({
    sender: account.accountAddress,
    data: {
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::${FUNCTION_NAME}`,
      functionArguments: [
        recipients.map(addr => addr.startsWith("0x") ? addr : `0x${addr}`),
        amounts.map(amount => new U64(amount)),
      ],
    },
  });

  // Sign and submit transaction
  console.log("\n🔐 Signing transaction...");
  const senderAuthenticator = aptos.transaction.sign({
    signer: account,
    transaction,
  });

  console.log("📡 Submitting transaction...");
  const pendingTxn = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator,
  });

  console.log(`\n⏳ Transaction submitted: ${pendingTxn.hash}`);
  console.log(`🔗 View on explorer: https://testnet.movementnetwork.xyz/txn/${pendingTxn.hash}`);

  // Wait for transaction confirmation
  console.log("\n⏳ Waiting for confirmation...");
  try {
    const executedTxn = await aptos.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });

    if (executedTxn.success) {
      console.log("✅ Transaction confirmed successfully!");
      console.log(`📊 Gas used: ${executedTxn.gas_used}`);
    //   console.log(`💰 Gas unit price: ${executedTxn.gas_unit_price}`);
    } else {
      console.error("❌ Transaction failed:", executedTxn.vm_status);
      throw new Error(`Transaction failed: ${executedTxn.vm_status}`);
    }
  } catch (error: any) {
    console.error("❌ Error waiting for transaction:", error);
    
    // Provide helpful error messages for common issues
    if (error?.message?.includes("ECOIN_STORE_NOT_PUBLISHED")) {
      console.error("\n💡 Tip: One or more recipient accounts are not registered for AptosCoin.");
      console.error("   Recipients must register before receiving MOVE tokens.");
    } else if (error?.message?.includes("EINSUFFICIENT_BALANCE")) {
      console.error("\n💡 Tip: Insufficient balance. Make sure you have enough MOVE tokens.");
    }
    
    throw error;
  }
}

// Main execution
async function main() {
  // Example usage - modify these values as needed
  const recipients = [
    "0xf136610f92fb19db84152cf4d9b7e63ce135597c7fa77cec43947620f977c7f8", // Replace with actual recipient addresses
    "0xc8887393decbbd7eab16d4c50831d39a58dec794e9ad96e6d25f6aff1570af35", // Replace with actual recipient addresses
  ];

  const amounts = [
    100_000_000, // 1 MOVE (in octas)
    200_000_000, // 2 MOVE (in octas)
  ];

  // You can also pass recipients and amounts as command line arguments
  // Example: tsx scripts/send_multiple.ts 0x123... 100000000 0xabc... 200000000
  if (process.argv.length > 2) {
    const args = process.argv.slice(2);
    if (args.length % 2 !== 0) {
      console.error("Usage: tsx scripts/send_multiple.ts <recipient1> <amount1> <recipient2> <amount2> ...");
      console.error("Amounts should be in octas (1 MOVE = 100,000,000 octas)");
      process.exit(1);
    }

    const parsedRecipients: string[] = [];
    const parsedAmounts: number[] = [];

    for (let i = 0; i < args.length; i += 2) {
      parsedRecipients.push(args[i]);
      parsedAmounts.push(parseInt(args[i + 1], 10));
    }

    await sendMoveToMultiple(parsedRecipients, parsedAmounts);
  } else {
    // Use default example values
    console.log("ℹ️  Using example recipients and amounts.");
    console.log("💡 To specify custom recipients and amounts, use:");
    console.log("   npm run send <recipient1> <amount1> <recipient2> <amount2> ...");
    console.log("   Example: npm run send 0x123... 100000000 0xabc... 200000000\n");

    // Uncomment the line below to run with example values
    await sendMoveToMultiple(recipients, amounts);
    console.log("⚠️  Please update the script with actual recipient addresses or use command line arguments.");
  }
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

