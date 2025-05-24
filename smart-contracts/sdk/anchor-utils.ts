import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  Commitment,
  ConfirmOptions,
  TransactionSignature,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  AccountMeta,
  Signer,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError,
  Account as TokenAccount,
  Mint,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import {
  AnchorProvider,
  Program,
  Idl,
  BN,
  web3,
  utils,
  AnchorError,
  ProgramError,
  IdlTypes,
  IdlAccounts,
  MethodsBuilder,
} from '@coral-xyz/anchor';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

// Type utilities for better type inference
export type ExtractAccountType<P extends Program> = P extends Program<infer T> ? T : never;
export type ExtractIdlType<T extends Idl> = T;
export type AccountNamespace<T extends Idl> = IdlAccounts<T>;
export type TypeDef<T extends Idl, N extends string> = IdlTypes<T>[N];

// Common constants
export const DEFAULT_COMMITMENT: Commitment = 'confirmed';
export const DEFAULT_CONFIRM_OPTIONS: ConfirmOptions = {
  commitment: 'confirmed',
  preflightCommitment: 'processed',
  skipPreflight: false,
};

// Compute budget constants
export const DEFAULT_COMPUTE_UNITS = 200_000;
export const DEFAULT_COMPUTE_UNIT_PRICE = 1;

// Program initialization utilities
export interface ProgramConfig<T extends Idl = Idl> {
  programId: PublicKey;
  idl: T;
  provider?: AnchorProvider;
  connection?: Connection;
  wallet?: WalletInterface;
  opts?: ConfirmOptions;
}

export interface WalletInterface {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

/**
 * Initialize an Anchor program with proper typing
 */
export function initializeProgram<T extends Idl>(
  config: ProgramConfig<T>
): Program<T> {
  let provider: AnchorProvider;

  if (config.provider) {
    provider = config.provider;
  } else if (config.connection && config.wallet) {
    provider = new AnchorProvider(
      config.connection,
      config.wallet as any,
      config.opts || DEFAULT_CONFIRM_OPTIONS
    );
  } else {
    throw new Error('Either provider or both connection and wallet must be provided');
  }

  return new Program<T>(config.idl, config.programId, provider);
}

/**
 * Create a local provider for testing
 */
export function createLocalProvider(
  keypair?: Keypair,
  endpoint: string = 'http://localhost:8899'
): AnchorProvider {
  const connection = new Connection(endpoint, DEFAULT_COMMITMENT);
  const wallet = keypair || Keypair.generate();
  
  return new AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: async (tx) => {
        tx.sign(wallet);
        return tx;
      },
      signAllTransactions: async (txs) => {
        txs.forEach(tx => tx.sign(wallet));
        return txs;
      },
    } as any,
    DEFAULT_CONFIRM_OPTIONS
  );
}

// PDA Derivation Helper Functions
export interface PDADerivation {
  address: PublicKey;
  bump: number;
}

/**
 * Generic PDA finder with caching
 */
const pdaCache = new Map<string, PDADerivation>();

export function findProgramAddress(
  seeds: (Buffer | Uint8Array)[],
  programId: PublicKey,
  useCache: boolean = true
): PDADerivation {
  const cacheKey = `${seeds.map(s => bs58.encode(s)).join('-')}-${programId.toBase58()}`;
  
  if (useCache && pdaCache.has(cacheKey)) {
    return pdaCache.get(cacheKey)!;
  }

  const [address, bump] = PublicKey.findProgramAddressSync(seeds, programId);
  const result = { address, bump };

  if (useCache) {
    pdaCache.set(cacheKey, result);
  }

  return result;
}

/**
 * Common PDA derivations for the event ticketing system
 */
export const PDAs = {
  // Events Program PDAs
  event: (eventId: string, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('event'), Buffer.from(eventId)],
      programId
    );
  },

  eventStats: (eventId: string, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('event_stats'), Buffer.from(eventId)],
      programId
    );
  },

  eventTreasury: (eventId: string, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('event_treasury'), Buffer.from(eventId)],
      programId
    );
  },

  // Ticket NFT PDAs
  ticketMetadata: (mint: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('ticket_metadata'), mint.toBuffer()],
      programId
    );
  },

  ticketCollection: (eventId: string, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('ticket_collection'), Buffer.from(eventId)],
      programId
    );
  },

  // Marketplace PDAs
  marketplaceConfig: (programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('marketplace_config')],
      programId
    );
  },

  listing: (nftMint: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('listing'), nftMint.toBuffer()],
      programId
    );
  },

  escrow: (listing: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('escrow'), listing.toBuffer()],
      programId
    );
  },

  bidVault: (listing: PublicKey, bidder: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('bid_vault'), listing.toBuffer(), bidder.toBuffer()],
      programId
    );
  },

  // Content Access PDAs
  accessConfig: (programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('access_config')],
      programId
    );
  },

  contentRegistry: (contentId: string, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('content'), Buffer.from(contentId)],
      programId
    );
  },

  userAccess: (user: PublicKey, contentId: string, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('user_access'), user.toBuffer(), Buffer.from(contentId)],
      programId
    );
  },

  tierConfig: (tier: number | BN, programId: PublicKey): PDADerivation => {
    const tierBN = tier instanceof BN ? tier : new BN(tier);
    return findProgramAddress(
      [Buffer.from('tier_config'), tierBN.toArrayLike(Buffer, 'le', 8)],
      programId
    );
  },

  // Staking PDAs
  stakingPool: (mint: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('staking_pool'), mint.toBuffer()],
      programId
    );
  },

  stakeAccount: (user: PublicKey, pool: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('stake_account'), user.toBuffer(), pool.toBuffer()],
      programId
    );
  },

  rewardVault: (pool: PublicKey, programId: PublicKey): PDADerivation => {
    return findProgramAddress(
      [Buffer.from('reward_vault'), pool.toBuffer()],
      programId
    );
  },
};

// Account Validation and Parsing Utilities
export interface AccountValidation {
  exists: boolean;
  owner?: PublicKey;
  lamports?: number;
  data?: Buffer;
  error?: string;
}

/**
 * Validate account existence and ownership
 */
export async function validateAccount(
  connection: Connection,
  address: PublicKey,
  expectedOwner?: PublicKey
): Promise<AccountValidation> {
  try {
    const accountInfo = await connection.getAccountInfo(address);
    
    if (!accountInfo) {
      return { exists: false, error: 'Account does not exist' };
    }

    if (expectedOwner && !accountInfo.owner.equals(expectedOwner)) {
      return {
        exists: true,
        owner: accountInfo.owner,
        error: `Account owned by ${accountInfo.owner.toBase58()}, expected ${expectedOwner.toBase58()}`,
      };
    }

    return {
      exists: true,
      owner: accountInfo.owner,
      lamports: accountInfo.lamports,
      data: accountInfo.data,
    };
  } catch (error) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Parse account data with proper error handling
 */
export async function parseAccount<T>(
  program: Program,
  accountType: string,
  address: PublicKey
): Promise<T | null> {
  try {
    const account = await program.account[accountType].fetch(address);
    return account as T;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Account does not exist')) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetch multiple accounts with batching
 */
export async function fetchMultipleAccounts<T>(
  program: Program,
  accountType: string,
  addresses: PublicKey[],
  batchSize: number = 100
): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const batchResults = await program.account[accountType].fetchMultiple(batch);
    results.push(...batchResults);
  }
  
  return results;
}

// Transaction Building Helpers
export interface TransactionOptions {
  computeUnits?: number;
  computeUnitPrice?: number;
  skipPreflight?: boolean;
  preflightCommitment?: Commitment;
  minContextSlot?: number;
  additionalSigners?: Signer[];
}

/**
 * Build transaction with compute budget and proper configuration
 */
export async function buildTransaction(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  options?: TransactionOptions
): Promise<Transaction> {
  const transaction = new Transaction();

  // Add compute budget instructions if specified
  if (options?.computeUnits) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: options.computeUnits,
      })
    );
  }

  if (options?.computeUnitPrice) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.computeUnitPrice,
      })
    );
  }

  // Add main instructions
  instructions.forEach(ix => transaction.add(ix));

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = payer;

  return transaction;
}

/**
 * Build versioned transaction for better performance
 */
export async function buildVersionedTransaction(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: web3.AddressLookupTableAccount[] = []
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  return new VersionedTransaction(message);
}

/**
 * Send and confirm transaction with retry logic
 */
export async function sendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  signers: Signer[],
  options?: TransactionOptions,
  maxRetries: number = 3
): Promise<TransactionSignature> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const signature = await connection.sendTransaction(
        transaction,
        signers,
        {
          skipPreflight: options?.skipPreflight || false,
          preflightCommitment: options?.preflightCommitment || 'processed',
          minContextSlot: options?.minContextSlot,
        }
      );

      const confirmation = await connection.confirmTransaction(
        signature,
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      return signature;
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on certain errors
      if (error instanceof Error && 
          (error.message.includes('Blockhash not found') ||
           error.message.includes('insufficient funds'))) {
        throw error;
      }

      // Wait before retry
      if (i < maxRetries - 1) {
        await sleep((i + 1) * 1000);
      }
    }
  }

  throw lastError || new Error('Transaction failed after retries');
}

// Error Handling and Parsing
export interface ParsedError {
  code?: number;
  name?: string;
  message: string;
  logs?: string[];
}

/**
 * Parse Anchor/Solana errors into readable format
 */
export function parseError(error: any): ParsedError {
  // Handle Anchor errors
  if (error instanceof AnchorError) {
    return {
      code: error.error.errorCode.number,
      name: error.error.errorCode.code,
      message: error.error.errorMessage || error.toString(),
      logs: error.logs,
    };
  }

  // Handle program errors
  if (error instanceof ProgramError) {
    return {
      code: error.code,
      message: error.msg,
      logs: error.logs,
    };
  }

  // Handle SendTransactionError
  if (error.logs && Array.isArray(error.logs)) {
    const customError = parseCustomErrorFromLogs(error.logs);
    if (customError) {
      return {
        message: customError,
        logs: error.logs,
      };
    }
  }

  // Default error handling
  return {
    message: error.message || error.toString(),
    logs: error.logs,
  };
}

/**
 * Extract custom error from program logs
 */
function parseCustomErrorFromLogs(logs: string[]): string | null {
  for (const log of logs) {
    // Look for custom program errors
    if (log.includes('Error Message:')) {
      return log.split('Error Message:')[1].trim();
    }
    
    // Look for common error patterns
    if (log.includes('custom program error:')) {
      const hexError = log.match(/0x[0-9a-fA-F]+/);
      if (hexError) {
        const errorCode = parseInt(hexError[0], 16);
        return `Custom error code: ${errorCode}`;
      }
    }
  }

  return null;
}

// Type Safety Utilities
/**
 * Type-safe account fetcher
 */
export function createAccountFetcher<T extends Idl>(program: Program<T>) {
  return {
    async fetch<K extends keyof AccountNamespace<T>>(
      accountName: K,
      address: PublicKey
    ): Promise<AccountNamespace<T>[K] | null> {
      try {
        const account = await program.account[accountName as string].fetch(address);
        return account as AccountNamespace<T>[K];
      } catch (error) {
        if (error instanceof Error && error.message.includes('Account does not exist')) {
          return null;
        }
        throw error;
      }
    },

    async fetchMultiple<K extends keyof AccountNamespace<T>>(
      accountName: K,
      addresses: PublicKey[]
    ): Promise<(AccountNamespace<T>[K] | null)[]> {
      const accounts = await program.account[accountName as string].fetchMultiple(addresses);
      return accounts as (AccountNamespace<T>[K] | null)[];
    },
  };
}

/**
 * Type-safe instruction builder
 */
export function createInstructionBuilder<T extends Idl>(program: Program<T>) {
  return program.methods;
}

// Connection Management and Provider Setup
export interface ConnectionManager {
  connection: Connection;
  commitment: Commitment;
  getSlot(): Promise<number>;
  getBalance(address: PublicKey): Promise<number>;
  getMinimumBalanceForRentExemption(dataLength: number): Promise<number>;
  requestAirdrop(address: PublicKey, lamports: number): Promise<TransactionSignature>;
}

/**
 * Create a managed connection with helper methods
 */
export function createConnectionManager(
  endpoint: string,
  commitment: Commitment = 'confirmed'
): ConnectionManager {
  const connection = new Connection(endpoint, commitment);

  return {
    connection,
    commitment,
    
    async getSlot(): Promise<number> {
      return await connection.getSlot();
    },

    async getBalance(address: PublicKey): Promise<number> {
      return await connection.getBalance(address);
    },

    async getMinimumBalanceForRentExemption(dataLength: number): Promise<number> {
      return await connection.getMinimumBalanceForRentExemption(dataLength);
    },

    async requestAirdrop(
      address: PublicKey,
      lamports: number
    ): Promise<TransactionSignature> {
      const signature = await connection.requestAirdrop(address, lamports);
      await connection.confirmTransaction(signature);
      return signature;
    },
  };
}

// Keypair and Wallet Utilities
/**
 * Load keypair from file or create new one
 */
export async function loadOrCreateKeypair(
  path?: string
): Promise<Keypair> {
  if (path) {
    try {
      const fs = await import('fs');
      const secretKey = JSON.parse(fs.readFileSync(path, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(secretKey));
    } catch (error) {
      console.warn(`Failed to load keypair from ${path}, creating new one`);
    }
  }
  
  return Keypair.generate();
}

/**
 * Create a simple wallet interface from a keypair
 */
export function createWallet(keypair: Keypair): WalletInterface {
  return {
    publicKey: keypair.publicKey,
    
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof Transaction) {
        tx.sign(keypair);
      } else {
        tx.sign([keypair]);
      }
      return tx;
    },

    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> {
      txs.forEach(tx => {
        if (tx instanceof Transaction) {
          tx.sign(keypair);
        } else {
          tx.sign([keypair]);
        }
      });
      return txs;
    },
  };
}

// Token utilities
export interface TokenInfo {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
  isNative: boolean;
}

/**
 * Get or create associated token account
 */
export async function ensureTokenAccount(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  
  try {
    await getAccount(connection, ata);
    return ata;
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      // Account doesn't exist, create instruction to create it
      return ata;
    }
    throw error;
  }
}

/**
 * Get token account info with mint details
 */
export async function getTokenInfo(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<TokenInfo | null> {
  try {
    const account = await getAccount(connection, tokenAccount);
    const mint = await getMint(connection, account.mint);
    
    return {
      mint: account.mint,
      owner: account.owner,
      amount: account.amount,
      decimals: mint.decimals,
      isNative: account.isNative,
    };
  } catch (error) {
    return null;
  }
}

// Utility functions
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function shortenAddress(address: PublicKey | string, chars: number = 4): string {
  const addr = typeof address === 'string' ? address : address.toBase58();
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

export function lamportsToSol(lamports: number | bigint | BN): number {
  const value = typeof lamports === 'bigint' ? Number(lamports) : 
                lamports instanceof BN ? lamports.toNumber() : lamports;
  return value / web3.LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * web3.LAMPORTS_PER_SOL);
}

// Re-export commonly used items
export {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BN,
} from '@solana/web3.js';

export { utils } from '@coral-xyz/anchor';
