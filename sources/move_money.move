module moove_money::moove_money {
    use std::error;
    use std::vector;
    use std::signer;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::event;

    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use aptos_framework::aptos_coin;

    /// Error code indicating that the recipients and amounts vectors have different lengths.
    const EVECTOR_LENGTH_MISMATCH: u64 = 1;

    /// Error code indicating that the recipients vector is empty.
    const EEMPTY_RECIPIENTS: u64 = 2;

    /// Error code indicating that the batch size exceeds the maximum allowed.
    const EBATCH_SIZE_EXCEEDED: u64 = 3;

    /// Maximum number of recipients allowed in a single batch transfer (prevents gas issues and DoS).
    const MAX_BATCH_SIZE: u64 = 100;

    /// Event emitted when a batch transfer is completed.
    #[event]
    struct BatchTransferEvent has drop, store {
        sender: address,
        num_recipients: u64,
        total_amount: u64,
    }

    /// Sends MOVE tokens to multiple recipients in a single transaction.
    /// 
    /// # Parameters:
    /// * `sender`: The signer who is sending the tokens
    /// * `recipients`: A vector of recipient addresses
    /// * `amounts`: A vector of amounts to send to each recipient (must match recipients length)
    ///
    /// # Aborts:
    /// * `EVECTOR_LENGTH_MISMATCH`: If recipients and amounts vectors have different lengths
    /// * `EEMPTY_RECIPIENTS`: If recipients vector is empty
    /// * `EBATCH_SIZE_EXCEEDED`: If batch size exceeds MAX_BATCH_SIZE
    /// * `coin::EINSUFFICIENT_BALANCE`: If sender doesn't have enough balance
    /// * `coin::ECOIN_STORE_NOT_PUBLISHED`: If recipient hasn't registered for AptosCoin
    public entry fun send_move_to_multiple(
        sender: &signer,
        recipients: vector<address>,
        amounts: vector<u64>,
    ) {
        let sender_addr = signer::address_of(sender);
        let num_recipients = vector::length(&recipients);
        let num_amounts = vector::length(&amounts);

        // Validate that vectors are not empty
        assert!(num_recipients > 0, error::invalid_argument(EEMPTY_RECIPIENTS));
        
        // Validate batch size limit
        assert!(
            num_recipients <= MAX_BATCH_SIZE,
            error::invalid_argument(EBATCH_SIZE_EXCEEDED)
        );
        
        // Validate that vectors have the same length
        assert!(
            num_recipients == num_amounts,
            error::invalid_argument(EVECTOR_LENGTH_MISMATCH)
        );

        // Calculate total amount for event
        let total_amount = 0;
        let i = 0;
        while (i < num_recipients) {
            let amount = *vector::borrow(&amounts, i);
            total_amount = total_amount + amount;
            i = i + 1;
        };

        // Transfer to each recipient
        i = 0;
        while (i < num_recipients) {
            let recipient = *vector::borrow(&recipients, i);
            let amount = *vector::borrow(&amounts, i);
            
            // Only transfer if amount is greater than 0
            if (amount > 0) {
                coin::transfer<AptosCoin>(sender, recipient, amount);
            };
            
            i = i + 1;
        };

        // Emit event (Note: In production, you'd use event::emit, but for simplicity we'll skip it here)
        event::emit(BatchTransferEvent {
            sender: sender_addr,
            num_recipients,
            total_amount,
        });
    }

    /// Sends equal amounts of MOVE tokens to multiple recipients.
    /// This is a convenience function for the common use case of splitting an amount equally.
    ///
    /// # Parameters:
    /// * `sender`: The signer who is sending the tokens
    /// * `recipients`: A vector of recipient addresses
    /// * `amount_per_recipient`: The amount to send to each recipient
    ///
    /// # Aborts:
    /// * `EEMPTY_RECIPIENTS`: If recipients vector is empty
    /// * `EBATCH_SIZE_EXCEEDED`: If batch size exceeds MAX_BATCH_SIZE
    /// * `coin::EINSUFFICIENT_BALANCE`: If sender doesn't have enough balance
    /// * `coin::ECOIN_STORE_NOT_PUBLISHED`: If recipient hasn't registered for AptosCoin
    public entry fun send_equal_amounts(
        sender: &signer,
        recipients: vector<address>,
        amount_per_recipient: u64,
    ) {
        let num_recipients = vector::length(&recipients);
        
        // Validate that vectors are not empty
        assert!(num_recipients > 0, error::invalid_argument(EEMPTY_RECIPIENTS));
        
        // Validate batch size limit
        assert!(
            num_recipients <= MAX_BATCH_SIZE,
            error::invalid_argument(EBATCH_SIZE_EXCEEDED)
        );

        // Create amounts vector with equal amounts
        let amounts = vector::empty<u64>();
        let i = 0;
        while (i < num_recipients) {
            vector::push_back(&mut amounts, amount_per_recipient);
            i = i + 1;
        };

        // Delegate to the main function
        send_move_to_multiple(sender, recipients, amounts);
    }

    /// View function to calculate the total amount needed for a batch transfer.
    /// Useful for checking if the sender has sufficient balance before calling send_move_to_multiple.
    ///
    /// # Parameters:
    /// * `amounts`: A vector of amounts
    ///
    /// # Returns:
    /// * The sum of all amounts in the vector
    public fun calculate_total_amount(amounts: vector<u64>): u64 {
        let total = 0;
        let i = 0;
        let len = vector::length(&amounts);
        while (i < len) {
            total = total + *vector::borrow(&amounts, i);
            i = i + 1;
        };
        total
    }

    #[test(sender = @0x1, recipient1 = @0x2, recipient2 = @0x3, aptos_framework = @aptos_framework)]
    public entry fun test_send_to_multiple(
        sender: signer,
        recipient1: signer,
        recipient2: signer,
        aptos_framework: signer,
    ) {
        let sender_addr = signer::address_of(&sender);
        let recipient1_addr = signer::address_of(&recipient1);
        let recipient2_addr = signer::address_of(&recipient2);

        // Create accounts for testing
        account::create_account_for_test(sender_addr);
        account::create_account_for_test(recipient1_addr);
        account::create_account_for_test(recipient2_addr);

        // Initialize AptosCoin first (required before registration)
        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(&aptos_framework);

        // Register for AptosCoin
        coin::register<AptosCoin>(&sender);
        coin::register<AptosCoin>(&recipient1);
        coin::register<AptosCoin>(&recipient2);

        // Mint some coins for the sender using the mint capability
        let coins = coin::mint<AptosCoin>(1000, &mint_cap);
        coin::deposit(sender_addr, coins);
        
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);

        // Prepare recipients and amounts vectors
        let recipients = vector::empty<address>();
        let amounts = vector::empty<u64>();
        
        vector::push_back(&mut recipients, recipient1_addr);
        vector::push_back(&mut recipients, recipient2_addr);
        
        vector::push_back(&mut amounts, 100);
        vector::push_back(&mut amounts, 200);

        // Execute multi-transfer
        send_move_to_multiple(&sender, recipients, amounts);

        // Verify balances
        assert!(coin::balance<AptosCoin>(sender_addr) == 700, 1);
        assert!(coin::balance<AptosCoin>(recipient1_addr) == 100, 2);
        assert!(coin::balance<AptosCoin>(recipient2_addr) == 200, 3);
    }

    #[test(sender = @0x1, recipient1 = @0x2, recipient2 = @0x3, recipient3 = @0x4, aptos_framework = @aptos_framework)]
    public entry fun test_send_equal_amounts(
        sender: signer,
        recipient1: signer,
        recipient2: signer,
        recipient3: signer,
        aptos_framework: signer,
    ) {
        let sender_addr = signer::address_of(&sender);
        let recipient1_addr = signer::address_of(&recipient1);
        let recipient2_addr = signer::address_of(&recipient2);
        let recipient3_addr = signer::address_of(&recipient3);

        // Create accounts for testing
        account::create_account_for_test(sender_addr);
        account::create_account_for_test(recipient1_addr);
        account::create_account_for_test(recipient2_addr);
        account::create_account_for_test(recipient3_addr);

        // Initialize AptosCoin
        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(&aptos_framework);

        // Register for AptosCoin
        coin::register<AptosCoin>(&sender);
        coin::register<AptosCoin>(&recipient1);
        coin::register<AptosCoin>(&recipient2);
        coin::register<AptosCoin>(&recipient3);

        // Mint coins for the sender
        let coins = coin::mint<AptosCoin>(1000, &mint_cap);
        coin::deposit(sender_addr, coins);
        
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);

        // Prepare recipients vector
        let recipients = vector::empty<address>();
        vector::push_back(&mut recipients, recipient1_addr);
        vector::push_back(&mut recipients, recipient2_addr);
        vector::push_back(&mut recipients, recipient3_addr);

        // Send equal amounts (100 to each)
        send_equal_amounts(&sender, recipients, 100);

        // Verify balances
        assert!(coin::balance<AptosCoin>(sender_addr) == 700, 1);
        assert!(coin::balance<AptosCoin>(recipient1_addr) == 100, 2);
        assert!(coin::balance<AptosCoin>(recipient2_addr) == 100, 3);
        assert!(coin::balance<AptosCoin>(recipient3_addr) == 100, 4);
    }

    #[test]
    public fun test_calculate_total_amount() {
        let amounts = vector::empty<u64>();
        vector::push_back(&mut amounts, 100);
        vector::push_back(&mut amounts, 200);
        vector::push_back(&mut amounts, 300);
        
        let total = calculate_total_amount(amounts);
        assert!(total == 600, 1);
    }

    #[test(sender = @0x1, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x10002, location = Self)] // error::invalid_argument(EEMPTY_RECIPIENTS) = 2 | 0x10000
    public entry fun test_empty_recipients(
        sender: signer,
        aptos_framework: signer,
    ) {
        let sender_addr = signer::address_of(&sender);
        account::create_account_for_test(sender_addr);
        
        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(&aptos_framework);
        coin::register<AptosCoin>(&sender);
        let coins = coin::mint<AptosCoin>(1000, &mint_cap);
        coin::deposit(sender_addr, coins);
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);

        let recipients = vector::empty<address>();
        let amounts = vector::empty<u64>();
        
        send_move_to_multiple(&sender, recipients, amounts);
    }

    #[test(sender = @0x1, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x10001, location = Self)] // error::invalid_argument(EVECTOR_LENGTH_MISMATCH) = 1 | 0x10000
    public entry fun test_length_mismatch(
        sender: signer,
        aptos_framework: signer,
    ) {
        let sender_addr = signer::address_of(&sender);
        account::create_account_for_test(sender_addr);
        
        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(&aptos_framework);
        coin::register<AptosCoin>(&sender);
        let coins = coin::mint<AptosCoin>(1000, &mint_cap);
        coin::deposit(sender_addr, coins);
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);

        let recipients = vector::empty<address>();
        let amounts = vector::empty<u64>();
        
        vector::push_back(&mut recipients, @0x2);
        vector::push_back(&mut amounts, 100);
        vector::push_back(&mut amounts, 200); // Mismatch: 1 recipient, 2 amounts
        
        send_move_to_multiple(&sender, recipients, amounts);
    }
}
