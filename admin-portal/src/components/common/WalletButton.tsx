// Render wallet options dropdown
  const renderWalletOptions = () => {
    if (!showDropdown || !isOpen) return null;

    return (
      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50">
        <div className="py-1">
          {wallets.map((walletOption) => (
            <button
              key={walletOption.adapter.name}
              onClick={() => handleWalletSelect(walletOption.adapter.name)}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center"
              disabled={connecting}
            >
              <img
                src={walletOption.adapter.icon}
                alt={walletOption.adapter.name}
                className="w-5 h-5 mr-3"
              />
              <span>{walletOption.adapter.name}</span>
              {wallet?.adapter.name === walletOption.adapter.name && connected && (
                <Check className="w-4 h-4 ml-auto text-green-600" />
              )}
            </button>
          ))}
          
          {connected && (
            <>
              <div className="border-t border-gray-200 my-1" />
              <button
                onClick={handleDisconnect}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Render button content
  const renderButtonContent = () => {
    if (children) {
      return children;
    }

    if (connecting) {
      return (
        <>
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
          Connecting...
        </>
      );
    }

    if (connected && publicKey) {
      const address = formatAddress(publicKey.toString());
      const walletName = wallet?.adapter.name || 'Wallet';
      
      return (
        <>
          <Wallet className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline mr-1">{walletName}:</span>
          <span className="font-mono">{address}</span>
          {user && isLinked && <Check className="w-4 h-4 ml-2 text-green-600" />}
          {showDropdown && <ChevronDown className="w-4 h-4 ml-2" />}
        </>
      );
    }

    return (
      <>
        <Wallet className="w-4 h-4 mr-2" />
        Connect Wallet
        {showDropdown && <ChevronDown className="w-4 h-4 ml-2" />}
      </>
    );
  };

  // Handle button click
  const handleClick = () => {
    if (connected && showDropdown) {
      setIsOpen(!isOpen);
    } else if (!connected && wallets.length === 1) {
      // If only one wallet available, connect directly
      handleWalletSelect(wallets[0].adapter.name);
    } else if (!connected && showDropdown) {
      setIsOpen(true);
    }
  };

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.wallet-button-container')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="wallet-button-container relative">
      <button
        onClick={handleClick}
        disabled={connecting}
        className={`
          relative inline-flex items-center justify-center rounded-md font-medium
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors duration-200
          ${sizeClasses[size]}
          ${variantClasses[variant]}
          ${className}
        `}
      >
        {renderButtonContent()}
      </button>
      
      {renderWalletOptions()}
      
      {/* Status indicator */}
      {connected && user && currentWalletInfo && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
      )}
    </div>
  );
}

// Wallet status component for showing detailed wallet info
export function WalletStatus() {
  const { connected, publicKey, wallet } = useWallet();
  const { user } = useAuth();
  const { getCurrentWalletInfo, formatAddress } = useWalletAuth();

  if (!connected || !publicKey) {
    return (
      <div className="text-sm text-gray-500">
        No wallet connected
      </div>
    );
  }

  const currentWalletInfo = getCurrentWalletInfo();
  const address = publicKey.toString();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Wallet</span>
        <span className="text-sm text-gray-500">{wallet?.adapter.name}</span>
      </div>
      
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Address</span>
        <div className="flex items-center">
          <span className="text-sm font-mono">{formatAddress(address)}</span>
          <button
            onClick={() => navigator.clipboard.writeText(address)}
            className="ml-2 text-gray-400 hover:text-gray-600"
            title="Copy address"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
      
      {user && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status</span>
          <div className="flex items-center">
            {currentWalletInfo ? (
              <>
                <span className="text-sm text-green-600">Linked</span>
                {currentWalletInfo.isPrimary && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Primary
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm text-yellow-600">Not linked</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
