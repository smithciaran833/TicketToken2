// services/nftVerificationService.js - Verify NFT ownership on Solana

const { Connection, PublicKey } = require('@solana/web3.js');
const { Metadata } = require('@metaplex-foundation/mpl-token-metadata');
const { programs } = require('@metaplex/js');
const NFTOwnership = require('../models/NFTOwnership');
const axios = require('axios');

class NFTVerificationService {
  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    // Cache to reduce RPC calls
    this.ownershipCache = new Map();
    this.metadataCache = new Map();
    
    // Third-party API endpoints for fallback verification
    this.heliusEndpoint = process.env.HELIUS_API_URL;
    this.heliusApiKey = process.env.HELIUS_API_KEY;
  }
  
  /**
   * Verify NFT ownership on-chain
   * @param {string} nftAddress - The NFT mint address
   * @param {string} walletAddress - The wallet to check ownership for
   * @returns {Promise<boolean>} True if wallet owns the NFT
   */
  async verifyNFTOwnership(nftAddress, walletAddress) {
    try {
      // Check cache first
      const cacheKey = `${nftAddress}:${walletAddress}`;
      if (this.ownershipCache.has(cacheKey)) {
        const { result, timestamp } = this.ownershipCache.get(cacheKey);
        
        // Cache for 5 minutes (adjust as needed)
        if (Date.now() - timestamp < 5 * 60 * 1000) {
          return result;
        }
      }
      
      // Verify on-chain
      const result = await this._verifyOnChain(nftAddress, walletAddress);
      
      // Update cache
      this.ownershipCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      console.error('NFT verification error:', error);
      
      // Fallback to third-party API
      try {
        return await this._verifyViaAPI(nftAddress, walletAddress);
      } catch (apiError) {
        console.error('API fallback verification error:', apiError);
        return false;
      }
    }
  }
  
  /**
   * Get metadata for an NFT
   * @param {string} nftAddress - The NFT mint address
   * @returns {Promise<Object>} NFT metadata
   */
  async getNFTMetadata(nftAddress) {
    try {
      // Check cache first
      if (this.metadataCache.has(nftAddress)) {
        const { metadata, timestamp } = this.metadataCache.get(nftAddress);
        
        // Cache for 1 hour (adjust as needed)
        if (Date.now() - timestamp < 60 * 60 * 1000) {
          return metadata;
        }
      }
      
      const metadata = await this._fetchMetadata(nftAddress);
      
      // Update cache
      this.metadataCache.set(nftAddress, {
        metadata,
        timestamp: Date.now()
      });
      
      return metadata;
    } catch (error) {
      console.error('NFT metadata error:', error);
      return null;
    }
  }
  
  /**
   * Sync NFT ownership data to our database
   * @param {string} walletAddress - The wallet to sync
   * @param {string} userId - Associated user ID (optional)
   * @returns {Promise<Object>} Sync result with counts
   */
  async syncWalletNFTs(walletAddress, userId = null) {
    try {
      // Get NFTs from on-chain or API
      const nfts = await this._fetchWalletNFTs(walletAddress);
      
      // Track results
      const result = {
        total: nfts.length,
        added: 0,
        updated: 0,
        failed: 0
      };
      
      // Process each NFT
      for (const nft of nfts) {
        try {
          // Get metadata if not included
          const metadata = nft.metadata || await this.getNFTMetadata(nft.mint);
          
          // Record ownership in database
          await NFTOwnership.recordOwnership({
            nftAddress: nft.mint,
            walletAddress,
            metadata
          }, userId);
          
          result.added++;
        } catch (error) {
          console.error(`Failed to process NFT ${nft.mint}:`, error);
          result.failed++;
        }
      }
      
      return result;
    } catch (error) {
      console.error('Sync wallet NFTs error:', error);
      throw error;
    }
  }
  
  /**
   * Verify NFT ownership on-chain directly
   * @private
   */
  async _verifyOnChain(nftAddress, walletAddress) {
    try {
      const mintPublicKey = new PublicKey(nftAddress);
      const walletPublicKey = new PublicKey(walletAddress);
      
      // Find the token account for this mint and wallet
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        walletPublicKey,
        { mint: mintPublicKey }
      );
      
      // Check if any account has a balance > 0
      for (const { account } of tokenAccounts.value) {
        const data = account.data;
        const amount = data.readBigUInt64LE(64);
        
        if (amount > 0) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('On-chain verification error:', error);
      throw error;
    }
  }
  
  /**
   * Verify NFT ownership via third-party API
   * @private
   */
  async _verifyViaAPI(nftAddress, walletAddress) {
    // If Helius API is configured, use it
    if (this.heliusEndpoint && this.heliusApiKey) {
      const response = await axios.post(
        `${this.heliusEndpoint}/v0/token-accounts`,
        {
          mintAccounts: [nftAddress],
          includeNft: false
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.heliusApiKey
          }
        }
      );
      
      if (response.data && response.data.length > 0) {
        const tokenAccount = response.data[0];
        return tokenAccount.owner === walletAddress;
      }
    }
    
    // Fallback to another service or method
    return false;
  }
  
  /**
   * Fetch NFT metadata
   * @private
   */
  async _fetchMetadata(nftAddress) {
    try {
      const mintPublicKey = new PublicKey(nftAddress);
      
      // Get metadata PDA for mint
      const metadataPDA = await Metadata.getPDA(mintPublicKey);
      
      // Get metadata account info
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA);
      
      if (!metadataAccount) {
        throw new Error('Metadata account not found');
      }
      
      // Decode the metadata
      const metadata = programs.metadata.MetadataData.deserialize(metadataAccount.data);
      
      // Fetch and parse URI data if available
      let externalMetadata = null;
      if (metadata.data.uri) {
        try {
          const response = await axios.get(metadata.data.uri);
          externalMetadata = response.data;
        } catch (error) {
          console.warn(`Failed to fetch metadata URI: ${metadata.data.uri}`, error);
        }
      }
      
      return {
        name: metadata.data.name,
        symbol: metadata.data.symbol,
        uri: metadata.data.uri,
        creators: metadata.data.creators,
        collection: metadata.collection,
        tokenStandard: metadata.tokenStandard,
        externalMetadata
      };
    } catch (error) {
      console.error('Metadata fetch error:', error);
      throw error;
    }
  }
  
  /**
   * Fetch all NFTs for a wallet
   * @private
   */
  async _fetchWalletNFTs(walletAddress) {
    // If Helius API is configured, use it for bulk fetching
    if (this.heliusEndpoint && this.heliusApiKey) {
      try {
        const response = await axios.post(
          `${this.heliusEndpoint}/v1/nfts`,
          {
            ownerAddress: walletAddress,
            limit: 100  // Adjust as needed
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.heliusApiKey
            }
          }
        );
        
        return response.data.nfts.map(nft => ({
          mint: nft.mint,
          metadata: {
            name: nft.name,
            description: nft.description,
            image: nft.image,
            attributes: nft.attributes,
            collection: nft.collection?.name,
            collectionAddress: nft.collection?.mintAddress,
            tokenId: nft.tokenId,
            standard: 'Metaplex'
          }
        }));
      } catch (error) {
        console.error('Helius API error:', error);
        // Fall through to on-chain method
      }
    }
    
    // On-chain method (limited and more expensive)
    try {
      const walletPublicKey = new PublicKey(walletAddress);
      
      // Get all token accounts owned by the wallet
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPublicKey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );
      
      // Filter for NFTs (amount = 1)
      const nftAccounts = tokenAccounts.value.filter(
        ta => ta.account.data.parsed.info.tokenAmount.amount === '1' && 
             ta.account.data.parsed.info.tokenAmount.decimals === 0
      );
      
      // Map to simplified format
      return nftAccounts.map(ta => ({
        mint: ta.account.data.parsed.info.mint
      }));
    } catch (error) {
      console.error('On-chain wallet NFT fetch error:', error);
      throw error;
    }
  }
  
  /**
   * Clear caches
   * @public
   */
  clearCaches() {
    this.ownershipCache.clear();
    this.metadataCache.clear();
  }
}

// Export singleton instance
module.exports = new NFTVerificationService();
