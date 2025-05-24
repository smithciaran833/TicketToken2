import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { TicketStaking } from '../target/types/ticket_staking';

describe('Staking Contract Tests', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TicketStaking as Program<TicketStaking>;
  
  // Generate keypairs for testing
  const stakingAuthority = Keypair.generate();
  const staker1 = Keypair.generate();
  const staker2 = Keypair.generate();
  
  // Test variables
  let stakingTokenMint: PublicKey;
  let rewardTokenMint: PublicKey;
  let stakingProgramAddress: PublicKey;
  let stakePoolAddress: PublicKey;
  
  let staker1TokenAccount: PublicKey;
  let staker2TokenAccount: PublicKey;
  let staker1RewardAccount: PublicKey;
  let staker2RewardAccount: PublicKey;
  
  let stakeVault: PublicKey;
  let rewardVault: PublicKey;
  
  // Constants
  const STAKER1_BALANCE = 100000 * 10**6; // 100k tokens
  const STAKER2_BALANCE = 50000 * 10**6; // 50k tokens
  const REWARD_POOL_BALANCE = 1000000 * 10**6; // 1M reward tokens
  const STAKE_AMOUNT_1 = 10000 * 10**6; // 10k tokens
  const STAKE_AMOUNT_2 = 5000 * 10**6; // 5k tokens
  
  before(async () => {
    console.log("Setting up staking test environment...");
    
    // Fund accounts
    const accounts = [stakingAuthority, staker1, staker2];
    for (const account of accounts) {
      await provider.connection.requestAirdrop(account.publicKey, LAMPORTS_PER_SOL * 5);
    }
    
    // Wait for confirmations
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create staking token
    stakingTokenMint = await createMint(
      provider.connection,
      stakingAuthority,
      stakingAuthority.publicKey,
      null,
      6 // 6 decimals
    );
    
    // Create reward token (in this case, same as staking token)
    rewardTokenMint = stakingTokenMint;
    
    // Create token accounts
    staker1TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      staker1,
      stakingTokenMint,
      staker1.publicKey
    );
    
    staker2TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      staker2,
      stakingTokenMint,
      staker2.publicKey
    );
    
    staker1RewardAccount = staker1TokenAccount; // Same token for rewards
    staker2RewardAccount = staker2TokenAccount; // Same token for rewards
    
    // Mint tokens to stakers
    await mintTo(
      provider.connection,
      stakingAuthority,
      stakingTokenMint,
      staker1TokenAccount,
      stakingAuthority.publicKey,
      STAKER1_BALANCE
    );
    
    await mintTo(
      provider.connection,
      stakingAuthority,
      stakingTokenMint,
      staker2TokenAccount,
      stakingAuthority.publicKey,
      STAKER2_BALANCE
    );
    
    // Derive staking program PDA
    [stakingProgramAddress] = await PublicKey.findProgramAddress(
      [Buffer.from('staking_program')],
      program.programId
    );
  });
  
  describe("Staking Initialization", () => {
    it("Initializes staking program", async () => {
      const defaultConfig = {
        defaultCooldownPeriod: new anchor.BN(7 * 24 * 60 * 60), // 7 days
        rewardClaimCooldown: new anchor.BN(24 * 60 * 60), // 1 day
        earlyUnstakeFeeBps: 500, // 5%
        maxStakePools: 10,
        paused: false,
      };
      
      await program.methods
        .initializeStaking(defaultConfig)
        .accounts({
          authority: stakingAuthority.publicKey,
          stakingProgram: stakingProgramAddress,
          systemProgram: SystemProgram.programId,
        })
        .signers([stakingAuthority])
        .rpc();
        
      // Verify staking program was initialized
      const stakingProgram = await program.account.stakingProgram.fetch(stakingProgramAddress);
      assert.equal(stakingProgram.authority.toString(), stakingAuthority.publicKey.toString());
      assert.equal(stakingProgram.activePools, 0);
      assert.equal(stakingProgram.totalStaked.toNumber(), 0);
    });
  });
  
  describe("Stake Pool Creation", () => {
    it("Creates a general stake pool", async () => {
      // Derive stake pool PDA
      [stakePoolAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('stake_pool'), stakingProgramAddress.toBuffer(), Buffer.from([0, 0, 0, 0])],
        program.programId
      );
      
      // Derive vault addresses
      stakeVault = await anchor.utils.token.associatedAddress({
        mint: stakingTokenMint,
        owner: stakePoolAddress
      });
      
      rewardVault = await anchor.utils.token.associatedAddress({
        mint: rewardTokenMint,
        owner: stakePoolAddress
      });
      
      const poolConfig = {
        rewardRateBps: 1200, // 12% APY
        minStakeAmount: new anchor.BN(100 * 10**6), // 100 tokens
        maxStakeAmount: new anchor.BN(1000000 * 10**6), // 1M tokens
        cooldownPeriod: null, // Use default
        minStakingDuration: new anchor.BN(24 * 60 * 60), // 1 day
        acceptingStakes: true,
        poolCapacity: new anchor.BN(0), // Unlimited
        tierBonusEnabled: true,
      };
      
      await program.methods
        .createStakePool(poolConfig, { general: {} }) // PoolType::General
        .accounts({
          authority: stakingAuthority.publicKey,
          stakingProgram: stakingProgramAddress,
          stakeTokenMint: stakingTokenMint,
          rewardTokenMint: rewardTokenMint,
          stakeVault: stakeVault,
          rewardVault: rewardVault,
          stakePool: stakePoolAddress,
          associatedEvent: null,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([stakingAuthority])
        .rpc();
        
      // Verify stake pool was created
      const stakePool = await program.account.stakePool.fetch(stakePoolAddress);
      assert.equal(stakePool.poolId, 0);
      assert.equal(stakePool.stakeTokenMint.toString(), stakingTokenMint.toString());
      assert.equal(stakePool.rewardTokenMint.toString(), rewardTokenMint.toString());
      assert.deepEqual(stakePool.poolType, { general: {} });
      assert.equal(stakePool.totalStaked.toNumber(), 0);
      assert.equal(stakePool.active, true);
      
      // Verify staking program was updated
      const stakingProgram = await program.account.stakingProgram.fetch(stakingProgramAddress);
      assert.equal(stakingProgram.activePools, 1);
    });
  });
  
  describe("Token Staking", () => {
    it("Stakes tokens for staker1", async () => {
      const [userStakeAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('user_stake'), stakePoolAddress.toBuffer(), staker1.publicKey.toBuffer()],
        program.programId
      );
      
      // Check initial balance
      const initialBalance = await getAccount(provider.connection, staker1TokenAccount);
      
      await program.methods
        .stakeTokens(new anchor.BN(STAKE_AMOUNT_1))
        .accounts({
          user: staker1.publicKey,
          stakingProgram: stakingProgramAddress,
          stakePool: stakePoolAddress,
          userTokenAccount: staker1TokenAccount,
          stakeVault: stakeVault,
          userStake: userStakeAddress,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker1])
        .rpc();
        
      // Verify tokens were transferred
      const finalBalance = await getAccount(provider.connection, staker1TokenAccount);
      assert.equal(
        Number(initialBalance.amount) - Number(finalBalance.amount),
        STAKE_AMOUNT_1
      );
      
      // Verify user stake was created
      const userStake = await program.account.userStake.fetch(userStakeAddress);
      assert.equal(userStake.user.toString(), staker1.publicKey.toString());
      assert.equal(userStake.stakedAmount.toNumber(), STAKE_AMOUNT_1);
      assert.deepEqual(userStake.stakingTier, { bronze: {} });
      
      // Verify stake pool was updated
      const stakePool = await program.account.stakePool.fetch(stakePoolAddress);
      assert.equal(stakePool.totalStaked.toNumber(), STAKE_AMOUNT_1);
      assert.equal(stakePool.stakerCount, 1);
    });
    
    it("Stakes tokens for staker2", async () => {
      const [userStakeAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('user_stake'), stakePoolAddress.toBuffer(), staker2.publicKey.toBuffer()],
        program.programId
      );
      
      await program.methods
        .stakeTokens(new anchor.BN(STAKE_AMOUNT_2))
        .accounts({
          user: staker2.publicKey,
          stakingProgram: stakingProgramAddress,
          stakePool: stakePoolAddress,
          userTokenAccount: staker2TokenAccount,
          stakeVault: stakeVault,
          userStake: userStakeAddress,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2])
        .rpc();
        
      // Verify user stake was created
      const userStake = await program.account.userStake.fetch(userStakeAddress);
      assert.equal(userStake.stakedAmount.toNumber(), STAKE_AMOUNT_2);
      
      // Verify stake pool total was updated
      const stakePool = await program.account.stakePool.fetch(stakePoolAddress);
      assert.equal(stakePool.totalStaked.toNumber(), STAKE_AMOUNT_1 + STAKE_AMOUNT_2);
      assert.equal(stakePool.stakerCount, 2);
    });
  });
  
  describe("Reward Distribution", () => {
    it("Distributes rewards to the pool", async () => {
      // Create authority reward account and fund it
      const authorityRewardAccount = await createAssociatedTokenAccount(
        provider.connection,
        stakingAuthority,
        rewardTokenMint,
        stakingAuthority.publicKey
      );
      
      await mintTo(
        provider.connection,
        stakingAuthority,
        rewardTokenMint,
        authorityRewardAccount,
        stakingAuthority.publicKey,
        REWARD_POOL_BALANCE
      );
      
      const distributionAmount = 100000 * 10**6; // 100k reward tokens
      
      await program.methods
        .distributeRewards(new anchor.BN(distributionAmount))
        .accounts({
          authority: stakingAuthority.publicKey,
          stakingProgram: stakingProgramAddress,
          stakePool: stakePoolAddress,
          authorityRewardAccount: authorityRewardAccount,
          rewardVault: rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([stakingAuthority])
        .rpc();
        
      // Verify rewards were distributed
      const stakePool = await program.account.stakePool.fetch(stakePoolAddress);
      assert.equal(stakePool.availableRewards.toNumber(), distributionAmount);
    });
  });
  
  describe("Unstaking", () => {
    it("Initiates unstaking for staker1", async () => {
      const [userStakeAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('user_stake'), stakePoolAddress.toBuffer(), staker1.publicKey.toBuffer()],
        program.programId
      );
      
      const unstakeAmount = STAKE_AMOUNT_1 / 2; // Unstake half
      
      await program.methods
        .unstakeTokens(new anchor.BN(unstakeAmount))
        .accounts({
          user: staker1.publicKey,
          stakingProgram: stakingProgramAddress,
          stakePool: stakePoolAddress,
          userStake: userStakeAddress,
        })
        .signers([staker1])
        .rpc();
        
      // Verify unstake request was created
      const userStake = await program.account.userStake.fetch(userStakeAddress);
      assert.isNotNull(userStake.unstakeRequest);
      assert.equal(userStake.unstakeRequest.amount.toNumber(), unstakeAmount);
      assert.equal(userStake.stakedAmount.toNumber(), STAKE_AMOUNT_1 - unstakeAmount);
      
      // Verify stake pool total was updated
      const stakePool = await program.account.stakePool.fetch(stakePoolAddress);
      assert.equal(stakePool.totalStaked.toNumber(), STAKE_AMOUNT_1 - unstakeAmount + STAKE_AMOUNT_2);
    });
  });
});
