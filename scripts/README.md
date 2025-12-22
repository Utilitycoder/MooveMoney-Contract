# Send Multiple Script

This script allows you to send MOVE tokens to multiple recipients using the `send_move_to_multiple` function.

## Setup

1. Install dependencies:
```bash
npm install
```

## Usage

### Using command line arguments:

```bash
npm run send <recipient1> <amount1> <recipient2> <amount2> ...
```

**Example:**
```bash
npm run send 0x1234567890123456789012345678901234567890123456789012345678901234 100000000 0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd 200000000
```

**Note:** Amounts are in octas (1 MOVE = 100,000,000 octas)

### Modifying the script:

Edit `scripts/send_multiple.ts` and update the `recipients` and `amounts` arrays in the `main()` function, then uncomment the function call.

## Configuration

The script automatically reads your Movement configuration from `.movement/config.yaml`:
- Uses the `default` profile
- Uses the account address and private key from the config
- Connects to the testnet URL specified in the config

## Prerequisites

1. The module must be published to the blockchain
2. The sender account must have sufficient MOVE balance
3. All recipient accounts must be registered for AptosCoin (MOVE tokens)

## Publishing the Module

Before using this script, make sure your module is published:

```bash
movement publish --named-addresses moove_money=<your-account-address>
```

Replace `<your-account-address>` with your account address (found in `.movement/config.yaml`).

