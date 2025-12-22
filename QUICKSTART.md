# Quick Start Guide

## Prerequisites

1. **Publish the module** to Movement testnet:
```bash
movement publish --named-addresses moove_money=0xf136610f92fb19db84152cf4d9b7e63ce135597c7fa77cec43947620f977c7f8
```

2. **Install dependencies**:
```bash
npm install
```

## Using the Script

### Option 1: Command Line Arguments

Send MOVE tokens to multiple recipients:

```bash
npm run send <recipient1> <amount1> <recipient2> <amount2> ...
```

**Example:**
```bash
npm run send \
  0x1234567890123456789012345678901234567890123456789012345678901234 100000000 \
  0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd 200000000
```

**Note:** Amounts are in octas (1 MOVE = 100,000,000 octas)

### Option 2: Edit the Script

1. Open `scripts/send_multiple.ts`
2. Update the `recipients` and `amounts` arrays in the `main()` function
3. Uncomment the function call: `await sendMoveToMultiple(recipients, amounts);`
4. Run: `npm run send`

## Configuration

The script automatically uses:
- **Account**: From `.movement/config.yaml` (default profile)
- **Network**: Movement testnet (`https://testnet.movementnetwork.xyz/v1`)
- **Module**: `moove_money::moove_money::send_move_to_multiple`

## Important Notes

1. **Recipient accounts must be registered** for AptosCoin (MOVE tokens) before receiving transfers
2. **Sender must have sufficient balance** to cover all transfers plus gas fees
3. **Amounts are in octas** - multiply MOVE amounts by 100,000,000

## Creating Test Accounts

To create test accounts for testing the multi-transfer function:

```bash
npm run create-accounts [count]
```

**Example:**
```bash
npm run create-accounts 3
```

This will:
- Create the specified number of accounts (default: 2, max: 10)
- Fund each account with 1 MOVE from the faucet
- Register each account for AptosCoin
- Save account details to `test_accounts.json`

The script will display all account information including addresses, private keys, and public keys, making it easy to use them for testing.

## Registering Accounts for AptosCoin

Before an account can receive MOVE tokens, it must register for AptosCoin. The script will automatically:
- Check if the sender is registered and register if needed
- Check all recipients and show an error if any are not registered

### Register Your Account

To register your account (sender) for AptosCoin:
```bash
npm run register-coin
```

### Register Recipient Accounts

Recipient accounts need to register themselves. They can:
1. Use the Movement CLI:
```bash
movement account register-coin --coin-type 0x1::aptos_coin::AptosCoin
```

2. Or use the register script (if they have access to the project):
```bash
npm run register-coin
```

3. **Or create test accounts** (which automatically registers them):
```bash
npm run create-accounts
```

**Note:** The script will now check recipient registration before sending and provide clear error messages if any recipients are not registered.

## Troubleshooting

- **"Module not found"**: Make sure you've published the module first
- **"Insufficient balance"**: Check your account balance on the explorer
- **"Coin store not published"**: Recipient accounts need to register for AptosCoin first

