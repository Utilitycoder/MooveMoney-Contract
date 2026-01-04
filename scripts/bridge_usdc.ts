#!/usr/bin/env tsx

/**
 * Bridge USDC from Movement Mainnet to Base Mainnet using LayerZero OFT
 * 
 * This script bridges USDC.e from Movement (Aptos Move) to Base using LayerZero.
 * It directly calls the OFT Move module's entry functions.
 * 
 * Prerequisites:
 * - Ed25519 private key with USDC.e balance on Movement mainnet
 * - MOVE tokens for gas fees
 * 
 * Usage:
 *   npx tsx scripts/bridge_usdc.ts <amount> <base_recipient_address>
 *   
 *   Private key is read from .movement/config.yaml or PRIVATE_KEY env var
 */

import {
    Aptos,
    AptosConfig,
    Network,
    Ed25519PrivateKey,
    Account,
    AccountAddress,
    MoveVector,
    U8,
    U32,
    U64,
    Bool,
} from "@aptos-labs/ts-sdk";
import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { join } from "path";

// ============================================================================
// Configuration
// ============================================================================

// LayerZero Endpoint IDs
const LAYERZERO_EID = {
    MOVEMENT_MAINNET: 30325,
    BASE_MAINNET: 30184,
};

// Movement Mainnet RPC
const MOVEMENT_RPC = "https://mainnet.movementlabs.xyz/v1";

// OFT Module Address on Movement (USDC.e OFT)
// This is where the LayerZero OFT module is deployed
const OFT_MODULE_ADDRESS = "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39";

// USDC decimals
const USDC_DECIMALS = 6;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load private key from .movement/config.yaml or environment variable
 */
function loadPrivateKey(): string {
    // First, check environment variable
    if (process.env.PRIVATE_KEY) {
        const pk = process.env.PRIVATE_KEY;
        return pk.replace("ed25519-priv-", "").replace(/^0x/, "");
    }

    // Otherwise, load from .movement/config.yaml
    const configPath = join(process.cwd(), ".movement", "config.yaml");

    if (!existsSync(configPath)) {
        throw new Error(
            "Private key not found. Set PRIVATE_KEY env var or create .movement/config.yaml"
        );
    }

    const configContent = readFileSync(configPath, "utf-8");
    const config = parse(configContent);

    if (!config.profiles?.default?.private_key) {
        throw new Error("No private_key found in .movement/config.yaml");
    }

    return config.profiles.default.private_key.replace("ed25519-priv-", "");
}

/**
 * Convert an EVM address (20 bytes) to bytes32 format for LayerZero
 * Returns as a Uint8Array of 32 bytes (left-padded with zeros)
 */
function evmAddressToBytes32(address: string): Uint8Array {
    // Remove 0x prefix and validate
    const cleanAddress = address.toLowerCase().replace(/^0x/, "");

    if (cleanAddress.length !== 40) {
        throw new Error(`Invalid EVM address length: ${address}`);
    }

    // Pad to 32 bytes (left-padded with zeros)
    const paddedHex = cleanAddress.padStart(64, "0");

    // Convert to Uint8Array
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(paddedHex.substring(i * 2, i * 2 + 2), 16);
    }

    return bytes;
}

/**
 * Format token amount for display
 */
function formatAmount(amount: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(decimals, "0");
    return `${whole}.${fraction.slice(0, 4)}`;
}

// ============================================================================
// Main Bridge Function
// ============================================================================

async function bridgeUsdc(
    amountUsdc: number,
    baseRecipientAddress: string
): Promise<void> {
    console.log("\n🌉 USDC Bridge: Movement Mainnet → Base Mainnet (via LayerZero)");
    console.log("=".repeat(60));

    // Validate Base recipient address (EVM format)
    if (!/^0x[a-fA-F0-9]{40}$/.test(baseRecipientAddress)) {
        throw new Error(`Invalid Base address format: ${baseRecipientAddress}`);
    }

    // Load private key and create account
    console.log("\n🔑 Loading account...");
    const privateKeyHex = loadPrivateKey();
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    const account = Account.fromPrivateKey({ privateKey });

    console.log(`   Movement address: ${account.accountAddress.toString()}`);
    console.log(`   Base recipient: ${baseRecipientAddress}`);

    // Initialize Aptos client for Movement
    const aptosConfig = new AptosConfig({
        network: Network.CUSTOM,
        fullnode: MOVEMENT_RPC,
    });
    const aptos = new Aptos(aptosConfig);

    // Calculate amount in smallest units (USDC has 6 decimals)
    const amountLD = BigInt(Math.floor(amountUsdc * (10 ** USDC_DECIMALS)));
    const minAmountLD = amountLD * BigInt(99) / BigInt(100); // 1% slippage

    console.log(`\n📤 Transfer Details:`);
    console.log(`   Amount: ${amountUsdc} USDC.e`);
    console.log(`   Amount (raw): ${amountLD.toString()}`);
    console.log(`   Min receive (1% slippage): ${formatAmount(minAmountLD, USDC_DECIMALS)} USDC`);
    console.log(`   Destination: Base Mainnet (EID: ${LAYERZERO_EID.BASE_MAINNET})`);

    // Convert recipient address to bytes32
    const recipientBytes32 = evmAddressToBytes32(baseRecipientAddress);

    // Check MOVE balance for gas
    const moveBalance = await aptos.getAccountAPTAmount({
        accountAddress: account.accountAddress
    });

    console.log(`\n⛽ Gas Check:`);
    console.log(`   MOVE Balance: ${formatAmount(BigInt(moveBalance), 8)} MOVE`);

    // Step 1: Quote the send to get fee estimate
    console.log("\n💵 Getting fee quote via view function...");

    try {
        // The OFT module should have a quote_send view function
        // This is a view call (no transaction, just read)
        const quoteResult = await aptos.view({
            payload: {
                function: `${OFT_MODULE_ADDRESS}::oft::quote_send`,
                typeArguments: [],
                functionArguments: [
                    LAYERZERO_EID.BASE_MAINNET,          // dst_eid
                    Array.from(recipientBytes32),        // to (bytes32 as vector<u8>)
                    amountLD.toString(),                 // amount_ld
                    minAmountLD.toString(),              // min_amount_ld
                    [],                                  // extra_options (empty)
                    [],                                  // compose_msg (empty)
                    false,                               // pay_in_lz_token
                ],
            },
        });

        console.log("   Quote result:", quoteResult);

        // Parse the fee from the result
        const nativeFee = BigInt(quoteResult[0] as string);
        console.log(`   Native Fee: ${formatAmount(nativeFee, 8)} MOVE`);

        if (BigInt(moveBalance) < nativeFee) {
            throw new Error(
                `Insufficient MOVE for gas. Have ${formatAmount(BigInt(moveBalance), 8)}, need ${formatAmount(nativeFee, 8)} MOVE`
            );
        }

        // Step 2: Execute the bridge transaction
        console.log("\n🚀 Building bridge transaction...");

        const transaction = await aptos.transaction.build.simple({
            sender: account.accountAddress,
            data: {
                function: `${OFT_MODULE_ADDRESS}::oft::send`,
                typeArguments: [],
                functionArguments: [
                    LAYERZERO_EID.BASE_MAINNET,          // dst_eid
                    Array.from(recipientBytes32),        // to (bytes32 as vector<u8>)
                    amountLD,                            // amount_ld
                    minAmountLD,                         // min_amount_ld
                    [],                                  // extra_options
                    [],                                  // compose_msg
                    nativeFee,                           // native_fee
                    BigInt(0),                           // lz_token_fee
                ],
            },
        });

        console.log("   Signing transaction...");
        const senderAuthenticator = aptos.transaction.sign({
            signer: account,
            transaction,
        });

        console.log("   Submitting transaction...");
        const pendingTxn = await aptos.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });

        console.log(`   Transaction Hash: ${pendingTxn.hash}`);
        console.log(`   Waiting for confirmation...`);

        // Wait for confirmation
        const executedTxn = await aptos.waitForTransaction({
            transactionHash: pendingTxn.hash,
        });

        if (executedTxn.success) {
            console.log("\n✅ Bridge transaction confirmed!");
            console.log(`   Block: ${executedTxn.version}`);
            console.log(`   Gas Used: ${executedTxn.gas_used}`);
        } else {
            throw new Error(`Transaction failed: ${executedTxn.vm_status}`);
        }

        console.log("\n🔗 Track your transfer:");
        console.log(`   LayerZero Scan: https://layerzeroscan.com/tx/${pendingTxn.hash}`);
        console.log(`   Movement Explorer: https://explorer.movementlabs.xyz/txn/${pendingTxn.hash}`);

        console.log("\n⏳ Note: Cross-chain transfers typically take 1-5 minutes to complete.");
        console.log("   Check LayerZero Scan for the current status.\n");

    } catch (error: any) {
        // Handle specific errors
        if (error.message?.includes("FUNCTION_NOT_FOUND") || error.message?.includes("not found")) {
            console.error("\n⚠️  The OFT module functions may have different names.");
            console.error("    Check the deployed contract at:", OFT_MODULE_ADDRESS);
            console.error("    You may need to update the function names in this script.");
        }
        throw error;
    }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.error("❌ Error: Missing required arguments\n");
        console.error("Usage:");
        console.error("  npx tsx scripts/bridge_usdc.ts <amount> <base_recipient_address>\n");
        console.error("Arguments:");
        console.error("  amount                 - Amount of USDC to bridge (e.g., 10)");
        console.error("  base_recipient_address - Recipient address on Base mainnet (0x...)\n");
        console.error("Private key is loaded from .movement/config.yaml or PRIVATE_KEY env var\n");
        console.error("Example:");
        console.error("  npx tsx scripts/bridge_usdc.ts 10 0x742d35Cc6634C0532925a3b844Bc9e7595f...");
        process.exit(1);
    }

    const amount = parseFloat(args[0]);
    const recipient = args[1];

    if (isNaN(amount) || amount <= 0) {
        console.error(`❌ Error: Invalid amount "${args[0]}". Must be a positive number.`);
        process.exit(1);
    }

    try {
        await bridgeUsdc(amount, recipient);
    } catch (error: any) {
        console.error("\n❌ Bridge failed:", error.message);
        if (error.code) {
            console.error(`   Error code: ${error.code}`);
        }
        process.exit(1);
    }
}

main();
