# TicketToken Smart Contract Test Guide

This document explains how to run tests for the TicketToken smart contracts.

## Overview

The TicketToken smart contracts have a comprehensive test suite that covers:
- Core functionality testing
- Error and edge case handling
- Performance benchmarking

## Test Files

The test suite includes the following files:

1. **`ticket-minter.test.ts`** - Main functionality tests
   - Event management
   - Ticket type management
   - Ticket minting
   - Verification
   - Transfers
   - Marketplace operations

2. **`ticket-minter-errors.test.ts`** - Error handling and edge cases
   - Invalid input validation
   - Authorization checks
   - Capacity limits
   - Transfer restrictions

3. **`ticket-minter-performance.test.ts`** - Performance benchmarking
   - Creation of multiple events
   - Minting many tickets
   - Verification benchmarking
   - Execution time metrics

## Prerequisites

Before running the tests, make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v16 or later)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Solana CLI Tools](https://docs.solana.com/cli/install-solana-cli-tools) (v1.10 or later)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (v0.26 or later)

## Setting Up

1. Clone the repository:
   ```bash
   git clone https://github.com/your-organization/tickettoken.git
   cd tickettoken/contracts
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the smart contracts:
   ```bash
   anchor build
   ```

## Running Tests

### Running All Tests

To run all tests:

```bash
anchor test
```

This will:
1. Start a local Solana validator
2. Build the program
3. Deploy it to the local validator
4. Run all test files
5. Shut down the validator when done

### Running Specific Test Files

To run a specific test file:

```bash
anchor test --skip-build -- --grep "ticket-minter-errors"
```

The `--grep` option allows you to match specific test file names or test descriptions.

### Running Individual Tests

To run a specific test case:

```bash
anchor test --skip-build -- --grep "Creates an event"
```

This will run only the test case with the description "Creates an event".

## Test Configuration

### Test Accounts

The tests use the following accounts:

- **Provider Wallet** - The default Anchor wallet, used as the buyer
- **Event Organizer** - A generated keypair used to create events
- **Validator** - A generated keypair for ticket validation
- **Secondary Buyer** - A generated keypair for transfer testing

### Test Networks

The tests run on a local Solana validator by default. You can modify the `Anchor.toml` file to test on other networks:

```toml
[provider]
cluster = "devnet"  # Change to "devnet", "testnet", or "mainnet-beta"
wallet = "/path/to/wallet.json"
```

### Performance Test Settings

The performance tests have configurable parameters at the top of the file:

```typescript
const NUM_EVENTS = 3;
const TICKETS_PER_EVENT = 10;
const TICKET_TYPES_PER_EVENT = 2;
```

Adjust these values to increase or decrease the load for performance testing.

## Interpreting Test Results

### Success Criteria

A successful test run will show:

- All tests passing with green checkmarks
- No assertion failures
- No uncaught exceptions

### Performance Metrics

The performance tests output metrics including:

- Average execution time for each operation
- Maximum execution times
- Minimum execution times
- Total number of operations performed

Look for these metrics in the test output to evaluate performance.

## Troubleshooting

Common issues and their solutions:

### Test Timeouts

If tests timeout, increase the timeout setting:

```bash
anchor test -- --timeout 60000
```

This sets the timeout to 60 seconds instead of the default.

### Insufficient Balance

If tests fail with "Insufficient balance" errors:

```bash
Error: Insufficient balance
```

The test accounts need more SOL. Increase the airdrop amount in the `before` section of each test file.

### Transaction Simulation Errors

If transaction simulation errors occur:

```
Error: Transaction simulation failed: Error processing Instruction X
```

Check the error details and ensure the contract instructions are being called correctly.

## Adding New Tests

When adding new tests:

1. Follow the existing test structure
2. Use descriptive test names with the pattern "should do something"
3. Clean up created resources in an `after` block if necessary
4. Group related tests in `describe` blocks

Example:

```typescript
describe('New Feature', () => {
  it('should behave correctly in normal case', async () => {
    // Test code
  });
  
  it('should handle error conditions', async () => {
    // Test code
  });
});
```

## Continuous Integration

The tests are automatically run in CI when changes are pushed to the `contracts/**` path. See the GitHub Actions workflow in `.github/workflows/solana-contracts.yml`.
