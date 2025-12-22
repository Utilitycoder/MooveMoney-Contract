module moove_money::moove_money {
    use std::error;
    use std::vector;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;

    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use std::signer;
    #[test_only]
    use aptos_framework::aptos_coin;

    /// Error code indicating that the recipients and amounts vectors have different lengths.
    const EVECTOR_LENGTH_MISMATCH: u64 = 1;

    /// Error code indicating that the recipients vector is empty.
    const EEMPTY_RECIPIENTS: u64 = 2;

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
    /// * `coin::EINSUFFICIENT_BALANCE`: If sender doesn't have enough balance
    /// * `coin::ECOIN_STORE_NOT_PUBLISHED`: If recipient hasn't registered for AptosCoin
    public entry fun send_move_to_multiple(
        sender: &signer,
        recipients: vector<address>,
        amounts: vector<u64>,
    ) {
        let num_recipients = vector::length(&recipients);
        let num_amounts = vector::length(&amounts);

        // Validate that vectors are not empty
        assert!(num_recipients > 0, error::invalid_argument(EEMPTY_RECIPIENTS));
        
        // Validate that vectors have the same length
        assert!(
            num_recipients == num_amounts,
            error::invalid_argument(EVECTOR_LENGTH_MISMATCH)
        );

        // Transfer to each recipient
        let i = 0;
        while (i < num_recipients) {
            let recipient = *vector::borrow(&recipients, i);
            let amount = *vector::borrow(&amounts, i);
            
            // Only transfer if amount is greater than 0
            if (amount > 0) {
                coin::transfer<AptosCoin>(sender, recipient, amount);
            };
            
            i = i + 1;
        };
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
}
