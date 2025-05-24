const ethers = require('ethers');
const axios = require('axios');
const redis = require('../config/redis');

// Standard ERC721 interface
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)'
];

// Standard ERC1155 interface
const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])'
];

// Standard ERC20 interface
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

/**
 * Get appropriate provider based on chain ID
 * @param {string} chainId - Ethereum chain ID
 * @returns {ethers.JsonRpcProvider} - JSON RPC provider
 */
const getProvider = (chainId = '1') => {
  // Map of chain IDs to RPC URLs
  const providerUrls = {
    '1': process.env.ETH_MAINNET_RPC_URL,
    '137': process.env.POLYGON_RPC_URL,
    '10': process.env.OPTIMISM_RPC_URL,
    '42161': process.env.ARBITRUM_RPC_URL,
    // Add more chains as needed
  };

  const rpcUrl = providerUrls[chainId] || process.env.ETH_MAINNET_RPC_URL;
  return new ethers.JsonRpcProvider(rpcUrl);
};

/**
 * Detect token standard (ERC721, ERC1155, ERC20)
 * @param {string} contractAddress - Token contract address
 * @param {string} chainId - Ethereum chain ID
 * @returns {Promise<string>} - Token standard
 */
const detectTokenStandard = async (contractAddress, chainId = '1') => {
  // Check cache first
  const cacheKey = `token_standard:${chainId}:${contractAddress}`;
  const cachedStandard = await redis.get(cacheKey);
  
  if (cachedStandard) {
    return cachedStandard;
  }
  
  try {
    // Try to detect from an API like Etherscan
    const apiEndpoints = {
      '1': `https://api.etherscan.io/api?module=contract&action=getabi&address=${contractAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`,
      '137': `https://api.polygonscan.com/api?module=contract&action=getabi&address=${contractAddress}&apikey=${process.env.POLYGONSCAN_API_KEY}`,
      // Add more chains as needed
    };
    
    // If we have an API endpoint for this chain
    if (apiEndpoints[chainId]) {
      const response = await axios.get(apiEndpoints[chainId]);
      
      if (response.data.status === '1' && response.data.result) {
        const abi = JSON.parse(response.data.result);
        
        // Check for ERC721 interfaces
        if (abi.some(item => 
          (item.name === 'ownerOf' || item.name === 'tokenOfOwnerByIndex') && 
          item.type === 'function')) {
          await redis.set(cacheKey, 'ERC721', 'EX', 86400); // Cache for 24 hours
          return 'ERC721';
        }
        
        // Check for ERC1155 interfaces
        if (abi.some(item => 
          item.name === 'balanceOfBatch' && 
          item.type === 'function')) {
          await redis.set(cacheKey, 'ERC1155', 'EX', 86400);
          return 'ERC1155';
        }
        
        // Check for ERC20 interfaces
        if (abi.some(item => 
          item.name === 'decimals' && 
          item.type === 'function')) {
          await redis.set(cacheKey, 'ERC20', 'EX', 86400);
          return 'ERC20';
        }
      }
    }
    
    // If API detection failed, try direct contract interaction
    const provider = getProvider(chainId);
    
    // Try ERC721
    try {
      const erc721Contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
      await erc721Contract.supportsInterface('0x80ac58cd'); // ERC721 interface ID
      await redis.set(cacheKey, 'ERC721', 'EX', 86400);
      return 'ERC721';
    } catch (e) {
      // Not ERC721, continue
    }
    
    // Try ERC1155
    try {
      const erc1155Contract = new ethers.Contract(contractAddress, ERC1155_ABI, provider);
      await erc1155Contract.supportsInterface('0xd9b67a26'); // ERC1155 interface ID
      await redis.set(cacheKey, 'ERC1155', 'EX', 86400);
      return 'ERC1155';
    } catch (e) {
      // Not ERC1155, continue
    }
    
    // Try ERC20
    try {
      const erc20Contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
      await erc20Contract.decimals();
      await redis.set(cacheKey, 'ERC20', 'EX', 86400);
      return 'ERC20';
    } catch (e) {
      // Not ERC20, might be a custom contract
    }
    
    // Default to ERC721 if we couldn't detect
    await redis.set(cacheKey, 'UNKNOWN', 'EX', 3600); // Cache for 1 hour
    return 'UNKNOWN';
    
  } catch (error) {
    console.error('Error detecting token standard:', error);
    return 'UNKNOWN';
  }
};

/**
 * Verify if a wallet owns a specific token
 * @param {string} walletAddress - User's wallet address
 * @param {string} contractAddress - Token contract address
 * @param {string} tokenId - Specific token ID (optional for ERC20 and collection-wide checks)
 * @param {number} minAmount - Minimum amount required (default: 1)
 * @param {string} chainId - Ethereum chain ID (default: mainnet)
 * @returns {Promise<boolean>} - Whether the user owns the token
 */
const verifyTokenOwnership = async (
  walletAddress, 
  contractAddress, 
  tokenId = null, 
  minAmount = 1,
  chainId = '1'
) => {
  try {
    // Normalize addresses
    walletAddress = ethers.getAddress(walletAddress);
    contractAddress = ethers.getAddress(contractAddress);
    
    // Check cache first
    const cacheKey = `token_ownership:${chainId}:${walletAddress}:${contractAddress}:${tokenId || 'any'}:${minAmount}`;
    const cachedResult = await redis.get(cacheKey);
    
    if (cachedResult !== null) {
      return cachedResult === 'true';
    }
    
    const provider = getProvider(chainId);
    const tokenStandard = await detectTokenStandard(contractAddress, chainId);
    
    let ownsToken = false;
    
    if (tokenStandard === 'ERC721') {
      const erc721Contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
      
      if (tokenId) {
        // Check specific token
        try {
          const owner = await erc721Contract.ownerOf(tokenId);
          ownsToken = owner.toLowerCase() === walletAddress.toLowerCase();
        } catch (e) {
          ownsToken = false;
        }
      } else {
        // Check if user owns any token from the collection
        const balance = await erc721Contract.balanceOf(walletAddress);
        ownsToken = balance >= minAmount;
      }
    } else if (tokenStandard === 'ERC1155') {
      const erc1155Contract = new ethers.Contract(contractAddress, ERC1155_ABI, provider);
      
      if (tokenId) {
        // Check specific token
        const balance = await erc1155Contract.balanceOf(walletAddress, tokenId);
        ownsToken = balance >= minAmount;
      } else {
        // Without a specific tokenId for ERC1155, we can't verify
        // In this case, we'll need to query a subgraph or indexer service
        // For now, we'll return false
        ownsToken = false;
      }
    } else if (tokenStandard === 'ERC20') {
      const erc20Contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
      
      // Get token decimals
      const decimals = await erc20Contract.decimals();
      
      // Get user's balance
      const balance = await erc20Contract.balanceOf(walletAddress);
      
      // Convert minAmount to the correct unit with decimals
      const minAmountWithDecimals = ethers.parseUnits(minAmount.toString(), decimals);
      
      // Check if balance is >= required amount
      ownsToken = balance >= minAmountWithDecimals;
    }
    
    // Cache the result (5 minutes for positive results, 1 minute for negative)
    const cacheTTL = ownsToken ? 300 : 60;
    await redis.set(cacheKey, ownsToken.toString(), 'EX', cacheTTL);
    
    return ownsToken;
  } catch (error) {
    console.error('Error verifying token ownership:', error);
    return false;
  }
};

/**
 * Get all tokens owned by a wallet for a specific contract
 * @param {string} walletAddress - User's wallet address
 * @param {string} contractAddress - Token contract address
 * @param {string} chainId - Ethereum chain ID (default: mainnet)
 * @returns {Promise<Array>} - Array of owned token IDs
 */
const getOwnedTokens = async (walletAddress, contractAddress, chainId = '1') => {
  try {
    walletAddress = ethers.getAddress(walletAddress);
    contractAddress = ethers.getAddress(contractAddress);
    
    const provider = getProvider(chainId);
    const tokenStandard = await detectTokenStandard(contractAddress, chainId);
    
    const ownedTokens = [];
    
    if (tokenStandard === 'ERC721') {
      const erc721Contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
      const balance = await erc721Contract.balanceOf(walletAddress);
      
      // Get all tokens owned by the user
      for (let i = 0; i < balance; i++) {
        try {
          const tokenId = await erc721Contract.tokenOfOwnerByIndex(walletAddress, i);
          ownedTokens.push(tokenId.toString());
        } catch (e) {
          console.error('Error getting token:', e);
        }
      }
    } else if (tokenStandard === 'ERC1155' || tokenStandard === 'ERC20') {
      // For ERC1155 and ERC20, we'd need to query a subgraph or indexer
      // This is a more complex implementation and might require external APIs
      // For now, we'll return an empty array
    }
    
    return ownedTokens;
  } catch (error) {
    console.error('Error getting owned tokens:', error);
    return [];
  }
};

module.exports = {
  verifyTokenOwnership,
  getOwnedTokens,
  detectTokenStandard
};
