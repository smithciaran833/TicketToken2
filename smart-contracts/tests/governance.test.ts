import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { assert } from 'chai';
import { TicketGovernance } from '../target/types/ticket_governance';

describe('Governance Contract Tests', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TicketGovernance as Program<TicketGovernance>;
  
  // Generate keypairs for testing
  const governanceAuthority = Keypair.generate();
  const proposer = Keypair.generate();
  const voter1 = Keypair.generate();
  const voter2 = Keypair.generate();
  const delegate = Keypair.generate();
  
  // Test variables
  let governanceTokenMint: PublicKey;
  let governanceAddress: PublicKey;
  let proposerTokenAccount: PublicKey;
  let voter1TokenAccount: PublicKey;
  let voter2TokenAccount: PublicKey;
  let delegateTokenAccount: PublicKey;
  
  // Constants
  const GOVERNANCE_TOKEN_SUPPLY = 1000000; // 1 million tokens
  const PROPOSER_BALANCE = 10000; // 10k tokens (above threshold)
  const VOTER1_BALANCE = 50000; // 50k tokens
  const VOTER2_BALANCE = 30000; // 30k tokens
  const DELEGATE_BALANCE = 20000; // 20k tokens
  
  before(async () => {
    console.log("Setting up governance test environment...");
    
    // Fund accounts
    const accounts = [governanceAuthority, proposer, voter1, voter2, delegate];
    for (const account of accounts) {
      await provider.connection.requestAirdrop(account.publicKey, LAMPORTS_PER_SOL * 5);
    }
    
    // Wait for confirmations
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create governance token
    governanceTokenMint = await createMint(
      provider.connection,
      governanceAuthority,
      governanceAuthority.publicKey,
      null,
      6 // 6 decimals
    );
    
    // Create token accounts and mint tokens
    proposerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      proposer,
      governanceTokenMint,
      proposer.publicKey
    );
    
    voter1TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      voter1,
      governanceTokenMint,
      voter1.publicKey
    );
    
    voter2TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      voter2,
      governanceTokenMint,
      voter2.publicKey
    );
    
    delegateTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      delegate,
      governanceTokenMint,
      delegate.publicKey
    );
    
    // Mint tokens to accounts
    await mintTo(
      provider.connection,
      governanceAuthority,
      governanceTokenMint,
      proposerTokenAccount,
      governanceAuthority.publicKey,
      PROPOSER_BALANCE * 10**6
    );
    
    await mintTo(
      provider.connection,
      governanceAuthority,
      governanceTokenMint,
      voter1TokenAccount,
      governanceAuthority.publicKey,
      VOTER1_BALANCE * 10**6
    );
    
    await mintTo(
      provider.connection,
      governanceAuthority,
      governanceTokenMint,
      voter2TokenAccount,
      governanceAuthority.publicKey,
      VOTER2_BALANCE * 10**6
    );
    
    await mintTo(
      provider.connection,
      governanceAuthority,
      governanceTokenMint,
      delegateTokenAccount,
      governanceAuthority.publicKey,
      DELEGATE_BALANCE * 10**6
    );
    
    // Derive governance PDA
    [governanceAddress] = await PublicKey.findProgramAddress(
      [Buffer.from('governance'), governanceTokenMint.toBuffer()],
      program.programId
    );
  });
  
  describe("Governance Initialization", () => {
    it("Initializes governance", async () => {
      const defaultConfig = {
        proposalThreshold: new anchor.BN(1000 * 10**6), // 1000 tokens
        quorumThresholdBps: 500, // 5%
        approvalThresholdBps: 5000, // 50%
        votingDuration: new anchor.BN(7 * 24 * 60 * 60), // 7 days
        executionWindow: new anchor.BN(3 * 24 * 60 * 60), // 3 days
        proposalCooldown: new anchor.BN(24 * 60 * 60), // 1 day
      };
      
      await program.methods
        .initializeGovernance(defaultConfig)
        .accounts({
          authority: governanceAuthority.publicKey,
          governanceTokenMint: governanceTokenMint,
          governance: governanceAddress,
          systemProgram: SystemProgram.programId,
        })
        .signers([governanceAuthority])
        .rpc();
        
      // Verify governance was initialized
      const governance = await program.account.governance.fetch(governanceAddress);
      assert.equal(governance.authority.toString(), governanceAuthority.publicKey.toString());
      assert.equal(governance.governanceTokenMint.toString(), governanceTokenMint.toString());
      assert.equal(governance.proposalCount.toNumber(), 0);
      assert.equal(governance.config.proposalThreshold.toNumber(), 1000 * 10**6);
    });
  });
  
  describe("Proposal Creation", () => {
    it("Creates a governance proposal", async () => {
      const [proposalAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('proposal'), governanceAddress.toBuffer(), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])],
        program.programId
      );
      
      const [proposerVoterWeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), proposer.publicKey.toBuffer()],
        program.programId
      );
      
      await program.methods
        .createProposal(
          { general: {} }, // ProposalType::General
          "Test Proposal",
          "This is a test proposal for governance",
          [] // No execution instructions for this test
        )
        .accounts({
          proposer: proposer.publicKey,
          governance: governanceAddress,
          governanceTokenMint: governanceTokenMint,
          proposerTokenAccount: proposerTokenAccount,
          proposerVoterWeight: proposerVoterWeightAddress,
          proposal: proposalAddress,
          relatedEvent: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([proposer])
        .rpc();
        
      // Verify proposal was created
      const proposal = await program.account.proposal.fetch(proposalAddress);
      assert.equal(proposal.proposer.toString(), proposer.publicKey.toString());
      assert.equal(proposal.title, "Test Proposal");
      assert.deepEqual(proposal.proposalType, { general: {} });
      assert.deepEqual(proposal.state, { active: {} });
      assert.equal(proposal.id.toNumber(), 0);
      
      // Verify governance proposal count was incremented
      const governance = await program.account.governance.fetch(governanceAddress);
      assert.equal(governance.proposalCount.toNumber(), 1);
    });
  });
  
  describe("Voting", () => {
    it("Casts votes on a proposal", async () => {
      const [proposalAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('proposal'), governanceAddress.toBuffer(), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])],
        program.programId
      );
      
      const [voter1WeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), voter1.publicKey.toBuffer()],
        program.programId
      );
      
      const [voter1VoteAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('vote'), proposalAddress.toBuffer(), voter1.publicKey.toBuffer()],
        program.programId
      );
      
      // Cast a "Yes" vote from voter1
      await program.methods
        .castVote({ yes: {} }, null) // VoteType::Yes, no specific weight
        .accounts({
          voter: voter1.publicKey,
          governance: governanceAddress,
          governanceTokenMint: governanceTokenMint,
          proposal: proposalAddress,
          voterTokenAccount: voter1TokenAccount,
          voterWeight: voter1WeightAddress,
          vote: voter1VoteAddress,
          delegateVoterWeight: null, // No delegation for this voter
          systemProgram: SystemProgram.programId,
        })
        .signers([voter1])
        .rpc();
        
      // Verify vote was recorded
      const vote = await program.account.vote.fetch(voter1VoteAddress);
      assert.equal(vote.voter.toString(), voter1.publicKey.toString());
      assert.deepEqual(vote.voteType, { yes: {} });
      assert.equal(vote.weight.toNumber(), VOTER1_BALANCE * 10**6);
      
      // Verify proposal vote counts were updated
      const proposal = await program.account.proposal.fetch(proposalAddress);
      assert.equal(proposal.yesVotes.toNumber(), VOTER1_BALANCE * 10**6);
      assert.equal(proposal.totalVotes.toNumber(), VOTER1_BALANCE * 10**6);
      assert.equal(proposal.voterCount, 1);
    });
    
    it("Casts a 'No' vote from another voter", async () => {
      const [proposalAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('proposal'), governanceAddress.toBuffer(), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])],
        program.programId
      );
      
      const [voter2WeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), voter2.publicKey.toBuffer()],
        program.programId
      );
      
      const [voter2VoteAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('vote'), proposalAddress.toBuffer(), voter2.publicKey.toBuffer()],
        program.programId
      );
      
      // Cast a "No" vote from voter2
      await program.methods
        .castVote({ no: {} }, null) // VoteType::No
        .accounts({
          voter: voter2.publicKey,
          governance: governanceAddress,
          governanceTokenMint: governanceTokenMint,
          proposal: proposalAddress,
          voterTokenAccount: voter2TokenAccount,
          voterWeight: voter2WeightAddress,
          vote: voter2VoteAddress,
          delegateVoterWeight: null, // No delegation for this voter
          systemProgram: SystemProgram.programId,
        })
        .signers([voter2])
        .rpc();
        
      // Verify proposal vote counts were updated
      const proposal = await program.account.proposal.fetch(proposalAddress);
      assert.equal(proposal.yesVotes.toNumber(), VOTER1_BALANCE * 10**6);
      assert.equal(proposal.noVotes.toNumber(), VOTER2_BALANCE * 10**6);
      assert.equal(proposal.totalVotes.toNumber(), (VOTER1_BALANCE + VOTER2_BALANCE) * 10**6);
      assert.equal(proposal.voterCount, 2);
    });
  });
  
  describe("Vote Delegation", () => {
    it("Delegates votes to another account", async () => {
      const [voter1WeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), voter1.publicKey.toBuffer()],
        program.programId
      );
      
      const [delegateWeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), delegate.publicKey.toBuffer()],
        program.programId
      );
      
      const [delegationAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('delegation'), governanceAddress.toBuffer(), voter1.publicKey.toBuffer()],
        program.programId
      );
      
      await program.methods
        .delegateVotes(delegate.publicKey)
        .accounts({
          delegator: voter1.publicKey,
          governance: governanceAddress,
          governanceTokenMint: governanceTokenMint,
          delegatorTokenAccount: voter1TokenAccount,
          delegatorVoterWeight: voter1WeightAddress,
          delegateVoterWeight: delegateWeightAddress,
          delegation: delegationAddress,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter1])
        .rpc();
        
      // Verify delegation was recorded
      const delegation = await program.account.voteDelegation.fetch(delegationAddress);
      assert.equal(delegation.delegator.toString(), voter1.publicKey.toString());
      assert.equal(delegation.delegate.toString(), delegate.publicKey.toString());
      
      // Verify voter weight was updated
      const delegatorWeight = await program.account.voterWeight.fetch(voter1WeightAddress);
      assert.equal(delegatorWeight.delegate.toString(), delegate.publicKey.toString());
      
      // Verify delegate received the delegated weight
      const delegateWeight = await program.account.voterWeight.fetch(delegateWeightAddress);
      assert.equal(delegateWeight.delegatedWeight.toNumber(), VOTER1_BALANCE * 10**6);
    });
    
    it("Revokes vote delegation", async () => {
      const [voter1WeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), voter1.publicKey.toBuffer()],
        program.programId
      );
      
      const [delegateWeightAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('voter_weight'), governanceAddress.toBuffer(), delegate.publicKey.toBuffer()],
        program.programId
      );
      
      const [delegationAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('delegation'), governanceAddress.toBuffer(), voter1.publicKey.toBuffer()],
        program.programId
      );
      
      await program.methods
        .revokeDelegation()
        .accounts({
          delegator: voter1.publicKey,
          governance: governanceAddress,
          governanceTokenMint: governanceTokenMint,
          delegatorTokenAccount: voter1TokenAccount,
          delegatorVoterWeight: voter1WeightAddress,
          delegateVoterWeight: delegateWeightAddress,
          delegation: delegationAddress,
        })
        .signers([voter1])
        .rpc();
        
      // Verify delegation was removed
      const delegatorWeight = await program.account.voterWeight.fetch(voter1WeightAddress);
      assert.isNull(delegatorWeight.delegate);
      
      // Verify delegate's delegated weight was reduced
      const delegateWeight = await program.account.voterWeight.fetch(delegateWeightAddress);
      assert.equal(delegateWeight.delegatedWeight.toNumber(), 0);
      
      // Verify delegation account was closed
      try {
        await program.account.voteDelegation.fetch(delegationAddress);
        assert.fail("Delegation account should have been closed");
      } catch (error) {
        // Expected - account should not exist
      }
    });
  });
  
  describe("Proposal Management", () => {
    it("Cancels a proposal", async () => {
      const [proposalAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('proposal'), governanceAddress.toBuffer(), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])],
        program.programId
      );
      
      // Cancel by proposal creator
      await program.methods
        .cancelProposal()
        .accounts({
          authority: proposer.publicKey, // Proposer can cancel their own proposal
          governance: governanceAddress,
          governanceTokenMint: governanceTokenMint,
          proposal: proposalAddress,
        })
        .signers([proposer])
        .rpc();
        
      // Verify proposal was canceled
      const proposal = await program.account.proposal.fetch(proposalAddress);
      assert.deepEqual(proposal.state, { canceled: {} });
    });
  });
});
