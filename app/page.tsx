'use client'
import { useState } from 'react'
import { ethers, Contract } from 'ethers'

// Base network configuration
const BASE_CHAIN_ID = '0x2105' // Base mainnet
const BASE_RPC = 'https://mainnet.base.org'
const BASE_NETWORK = {
  chainId: BASE_CHAIN_ID,
  chainName: 'Base',
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: [BASE_RPC],
  blockExplorerUrls: ['https://basescan.org']
}

// USDC contract address on Ethereum mainnet
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

// Base Bridge contract addresses
const L1_BRIDGE_ADDRESS = '0x3154Cf16ccdb4C6d922629664174b904d80F2C35'  // ETH -> Base
const L2_BRIDGE_ADDRESS = '0x4200000000000000000000000000000000000010'  // Base -> ETH

// Bridge ABI (simplified for ETH deposits/withdrawals)
const BRIDGE_ABI = [
  'function depositTransaction(address to, uint256 value, uint64 gasLimit, bool isCreation, bytes data) payable',
  'function withdraw(address recipient, uint256 amount)'
]

interface ChainBalance {
  address: string;
  ethBalance: string;  // Ethereum mainnet
  baseBalance: string; // Base chain
}

interface TransferState {
  amount: string;
  sliderPosition: number;
  fromChain: 'eth' | 'base';
}

interface SendState {
  amount: string;
  recipient: string;
  sliderPosition: number;
  selectedChain: 'eth' | 'base';  // Add chain selection
}

const ETH_CHAIN_ID = '0x1'

// Add this helper function at the top
const isUserRejection = (error: any): boolean => {
  const errorMessage = error?.message?.toLowerCase() || ''
  return (
    errorMessage.includes('user rejected') ||
    errorMessage.includes('user denied') ||
    errorMessage.includes('rejected') ||
    error?.code === 4001 ||
    error?.code === 'ACTION_REJECTED'
  )
}

export default function Home() {
  const [metamask, setMetamask] = useState<ChainBalance>({ 
    address: '', 
    ethBalance: '',
    baseBalance: '' 
  })
  const [phantom, setPhantom] = useState<ChainBalance>({ 
    address: '', 
    ethBalance: '',
    baseBalance: '' 
  })
  const [error, setError] = useState('')
  const [transfer, setTransfer] = useState<TransferState>({
    amount: '',
    sliderPosition: 50,
    fromChain: 'eth'
  })
  const [send, setSend] = useState<SendState>({
    amount: '',
    recipient: '',
    sliderPosition: 50,
    selectedChain: 'eth'
  })

  // Function to get USDC balance
  const getUSDCBalance = async (provider: ethers.Provider, address: string) => {
    try {
      const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider)
      const decimals = await usdc.decimals()
      const balance = await usdc.balanceOf(address)
      return ethers.formatUnits(balance, decimals)
    } catch (err) {
      console.error('USDC balance error:', err)
      return '0'
    }
  }

  const switchToBase = async (provider: any) => {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_CHAIN_ID }],
      })
    } catch (switchError: any) {
      // If Base chain hasn't been added to the wallet yet
      if (switchError.code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_NETWORK],
          })
        } catch (addError) {
          throw new Error('Failed to add Base network')
        }
      } else {
        throw switchError
      }
    }
  }

  const getChainBalance = async (provider: any, address: string, chainId: string) => {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      })
      const ethProvider = new ethers.BrowserProvider(provider)
      const balance = await ethProvider.getBalance(address)
      return ethers.formatEther(balance)
    } catch (err) {
      console.error(`Balance error for chain ${chainId}:`, err)
      return '0'
    }
  }

  const connectMetamask = async () => {
    try {
      // Get the specific MetaMask provider
      let provider;
      
      if (window.ethereum?.providers) {
        provider = window.ethereum.providers.find((p: any) => p.isMetaMask && !p.isPhantom);
      } else if (window.ethereum?.isMetaMask && !window.ethereum?.isPhantom) {
        provider = window.ethereum;
      }

      if (!provider) {
        setError('Please install MetaMask!');
        return;
      }

      let ethBalance = '0';
      let baseBalance = '0';
      
      try {
        // Switch to ETH mainnet using MetaMask provider
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ETH_CHAIN_ID }]
        });
        
        // Get accounts from MetaMask specifically
        const accounts = await provider.request({ 
          method: 'eth_requestAccounts' 
        });
        
        if (!accounts || accounts.length === 0) {
          throw new Error('No MetaMask accounts found');
        }

        // Get ETH balance using MetaMask provider
        const ethProvider = new ethers.BrowserProvider(provider);
        const balance = await ethProvider.getBalance(accounts[0]);
        ethBalance = ethers.formatEther(balance);

        // Switch to Base
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID }]
          });
        } catch (switchError: any) {
          // Add Base if it doesn't exist
          if (switchError.code === 4902) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [BASE_NETWORK]
            });
          }
        }

        // Get Base balance using MetaMask provider
        const baseProvider = new ethers.BrowserProvider(provider);
        const baseBalanceWei = await baseProvider.getBalance(accounts[0]);
        baseBalance = ethers.formatEther(baseBalanceWei);

        setMetamask({
          address: accounts[0],
          ethBalance,
          baseBalance
        });
        
      } catch (err) {
        console.error('MetaMask balance fetch error:', err);
        const accounts = await provider.request({ 
          method: 'eth_requestAccounts' 
        });
        setMetamask({
          address: accounts[0],
          ethBalance: '0',
          baseBalance: '0'
        });
      }

    } catch (err) {
      console.error('MetaMask connection error:', err);
      setError('Failed to connect MetaMask: ' + (err as Error).message);
    }
  }

  const connectPhantom = async () => {
    try {
      // First check if we're already on Base chain
      const currentChainId = await window.ethereum?.request({ 
        method: 'eth_chainId' 
      });
      
      console.log('Current chain:', currentChainId);
      
      // Force Base chain first
      if (currentChainId !== BASE_CHAIN_ID) {
        try {
          await window.ethereum?.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID }],
          });
        } catch (switchError: any) {
          // Add Base if it doesn't exist
          if (switchError.code === 4902) {
            await window.ethereum?.request({
              method: 'wallet_addEthereumChain',
              params: [BASE_NETWORK],
            });
          } else {
            throw switchError;
          }
        }
      }

      // Now try to connect
      const accounts = await window.ethereum?.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const balance = await provider.getBalance(accounts[0]);

      console.log('Connected to Base with:', {
        account: accounts[0],
        balance: ethers.formatEther(balance)
      });

      const address = accounts[0]
      const ethBalance = await getChainBalance(window.ethereum, address, ETH_CHAIN_ID)
      const baseBalance = await getChainBalance(window.ethereum, address, BASE_CHAIN_ID)
      
      setPhantom({
        address,
        ethBalance,
        baseBalance
      })
      
    } catch (err) {
      console.error('Detailed connection error:', {
        error: err,
        ethereum: window.ethereum,
        isPhantom: window.ethereum?.isPhantom,
        providers: window.ethereum?.providers
      });
      setError('Failed to connect: ' + (err as Error).message);
    }
  }

  // Copy address function
  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address)
    // You might want to add a temporary "Copied!" message here
  }

  const handleTransferChange = (field: keyof TransferState, value: string | number) => {
    setTransfer(prev => ({ ...prev, [field]: value }))
  }

  const calculateSplitAmounts = () => {
    const totalAmount = parseFloat(transfer.amount) || 0
    const phantomShare = (100 - transfer.sliderPosition) / 100
    const metamaskShare = transfer.sliderPosition / 100

    return {
      phantom: totalAmount * phantomShare,
      metamask: totalAmount * metamaskShare
    }
  }

  const validateTransfer = () => {
    const { phantom: phantomAmount, metamask: metamaskAmount } = calculateSplitAmounts()
    const phantomBalance = parseFloat(phantom.baseBalance) || 0
    const metamaskBalance = parseFloat(metamask.baseBalance) || 0

    if (phantomAmount > phantomBalance) {
      return 'Insufficient Phantom balance'
    }
    if (metamaskAmount > metamaskBalance) {
      return 'Insufficient MetaMask balance'
    }
    if (!ethers.isAddress(transfer.recipient)) {
      return 'Invalid recipient address'
    }
    return null
  }

  const handleSend = async () => {
    const validationError = validateTransfer()
    if (validationError) {
      setError(validationError)
      return
    }

    // Implementation of actual send functionality will go here
    setError('Send functionality coming soon!')
  }

  // Calculate totals
  const getTotals = () => {
    const metamaskEth = parseFloat(metamask.ethBalance) || 0
    const metamaskBase = parseFloat(metamask.baseBalance) || 0
    const phantomEth = parseFloat(phantom.ethBalance) || 0
    const phantomBase = parseFloat(phantom.baseBalance) || 0

    return {
      ethTotal: (metamaskEth + phantomEth).toFixed(4),
      baseTotal: (metamaskBase + phantomBase).toFixed(4),
      grandTotal: (metamaskEth + phantomEth + metamaskBase + phantomBase).toFixed(4)
    }
  }

  // Calculate estimated received amount (this is a placeholder - you'll need real bridge rates)
  const getEstimatedReceived = () => {
    const amount = parseFloat(transfer.amount) || 0
    // Add actual bridge rate calculation here
    return (amount * 0.995).toFixed(4) // Example: 0.5% bridge fee
  }

  const bridgeETH = async () => {
    try {
      const amount = parseFloat(transfer.amount)
      if (!amount || amount <= 0) {
        setError('Please enter a valid amount')
        return
      }

      // Calculate amounts from each wallet based on slider
      const phantomAmount = (amount * (100 - transfer.sliderPosition)) / 100
      const metamaskAmount = (amount * transfer.sliderPosition) / 100

      // Validate balances
      const phantomBalance = parseFloat(phantom.ethBalance)
      const metamaskBalance = parseFloat(metamask.ethBalance)

      if (transfer.fromChain === 'eth') {
        // Check ETH chain balances
        if (phantomAmount > phantomBalance) {
          setError('Insufficient Phantom ETH balance')
          return
        }
        if (metamaskAmount > metamaskBalance) {
          setError('Insufficient MetaMask ETH balance')
          return
        }
      } else {
        // Check Base chain balances
        if (phantomAmount > parseFloat(phantom.baseBalance)) {
          setError('Insufficient Phantom Base balance')
          return
        }
        if (metamaskAmount > parseFloat(metamask.baseBalance)) {
          setError('Insufficient MetaMask Base balance')
          return
        }
      }

      // Bridge from each wallet if amount > 0
      if (phantomAmount > 0) {
        await bridgeFromWallet(
          window.ethereum?.providers?.find((p: any) => p.isPhantom) || window.ethereum,
          phantomAmount,
          phantom.address
        )
      }

      if (metamaskAmount > 0) {
        await bridgeFromWallet(
          window.ethereum?.providers?.find((p: any) => p.isMetaMask && !p.isPhantom) || window.ethereum,
          metamaskAmount,
          metamask.address
        )
      }

      // Only show success message if we get here
      setError('Bridge transactions submitted successfully!')
      
      // Refresh balances after a short delay
      setTimeout(async () => {
        if (phantom.address) await connectPhantom()
        if (metamask.address) await connectMetamask()
      }, 5000)

    } catch (err) {
      console.error('Bridge error:', err)
      if (!isUserRejection(err)) {
        setError('Failed to bridge: ' + (err as Error).message)
      }
    }
  }

  const bridgeFromWallet = async (provider: any, amount: number, fromAddress: string) => {
    if (!provider) throw new Error('Provider not found')

    try {
        // First request account access
        await provider.request({ 
            method: 'eth_requestAccounts' 
        })

        const ethAmount = ethers.parseEther(amount.toString())
        
        // Switch to correct network
        const targetChainId = transfer.fromChain === 'eth' ? ETH_CHAIN_ID : BASE_CHAIN_ID
        try {
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: targetChainId }]
            })
        } catch (switchError: any) {
            // If Base chain hasn't been added, add it
            if (switchError.code === 4902 && targetChainId === BASE_CHAIN_ID) {
                await provider.request({
                    method: 'wallet_addEthereumChain',
                    params: [BASE_NETWORK]
                })
            } else {
                throw switchError
            }
        }

        // Get fresh signer after network switch
        const ethersProvider = new ethers.BrowserProvider(provider)
        const signer = await ethersProvider.getSigner()

        if (transfer.fromChain === 'eth') {
            // ETH -> Base
            const bridge = new Contract(L1_BRIDGE_ADDRESS, BRIDGE_ABI, signer)
            
            // Request approval for the bridge transaction
            const gasLimit = 100000n
            
            console.log('Initiating bridge deposit...')
            const tx = await bridge.depositTransaction(
                fromAddress,
                ethAmount,
                gasLimit,
                false,
                '0x',
                { 
                    value: ethAmount,
                    gasLimit: 300000 // Explicit gas limit for L1 transaction
                }
            )
            
            console.log('Waiting for transaction confirmation...')
            await tx.wait()
            console.log('Bridge deposit confirmed:', tx.hash)
        } else {
            // Base -> ETH
            const bridge = new Contract(L2_BRIDGE_ADDRESS, BRIDGE_ABI, signer)
            
            console.log('Initiating bridge withdrawal...')
            const tx = await bridge.withdraw(
                fromAddress,
                ethAmount,
                { 
                    value: ethAmount,
                    gasLimit: 300000
                }
            )
            
            console.log('Waiting for transaction confirmation...')
            await tx.wait()
            console.log('Bridge withdrawal confirmed:', tx.hash)
        }

    } catch (err) {
        console.error('Detailed bridge error:', err)
        if (isUserRejection(err)) {
            throw new Error('denied by user')
        }
        throw new Error(`Bridge failed: ${(err as Error).message}`)
    }
  }

  // Add send function
  const sendETH = async () => {
    try {
      const amount = parseFloat(send.amount)
      if (!amount || amount <= 0) {
        setError('Please enter a valid amount')
        return
      }

      if (!ethers.isAddress(send.recipient)) {
        setError('Please enter a valid recipient address')
        return
      }

      // Calculate amounts from each wallet based on slider
      const phantomAmount = (amount * (100 - send.sliderPosition)) / 100
      const metamaskAmount = (amount * send.sliderPosition) / 100

      // Validate balances based on selected chain
      if (send.selectedChain === 'eth') {
        if (phantomAmount > parseFloat(phantom.ethBalance)) {
          setError('Insufficient Phantom ETH balance')
          return
        }
        if (metamaskAmount > parseFloat(metamask.ethBalance)) {
          setError('Insufficient MetaMask ETH balance')
          return
        }
      } else {
        if (phantomAmount > parseFloat(phantom.baseBalance)) {
          setError('Insufficient Phantom Base balance')
          return
        }
        if (metamaskAmount > parseFloat(metamask.baseBalance)) {
          setError('Insufficient MetaMask Base balance')
          return
        }
      }

      // Send from each wallet if amount > 0
      if (phantomAmount > 0) {
        await sendFromWallet(
          window.ethereum?.providers?.find((p: any) => p.isPhantom) || window.ethereum,
          phantomAmount,
          phantom.address
        )
      }

      if (metamaskAmount > 0) {
        await sendFromWallet(
          window.ethereum?.providers?.find((p: any) => p.isMetaMask && !p.isPhantom) || window.ethereum,
          metamaskAmount,
          metamask.address
        )
      }

      // Only show success message if we get here
      setError('Transactions sent successfully!')
      
      // Refresh balances after a short delay
      setTimeout(async () => {
        if (phantom.address) await connectPhantom()
        if (metamask.address) await connectMetamask()
      }, 5000)

    } catch (err) {
      console.error('Send error:', err)
      if (!isUserRejection(err)) {
        setError('Failed to send: ' + (err as Error).message)
      }
    }
  }

  const sendFromWallet = async (provider: any, amount: number, fromAddress: string) => {
    if (!provider) throw new Error('Provider not found')

    try {
      // Request account access
      await provider.request({ 
        method: 'eth_requestAccounts' 
      })

      const ethAmount = ethers.parseEther(amount.toString())
      
      // Switch to correct network
      const targetChainId = send.selectedChain === 'eth' ? ETH_CHAIN_ID : BASE_CHAIN_ID
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }]
        })
      } catch (switchError: any) {
        if (switchError.code === 4902 && targetChainId === BASE_CHAIN_ID) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_NETWORK]
          })
        } else {
          throw switchError
        }
      }

      // Get fresh signer after network switch
      const ethersProvider = new ethers.BrowserProvider(provider)
      const signer = await ethersProvider.getSigner()

      // Send transaction
      const tx = await signer.sendTransaction({
        to: send.recipient,
        value: ethAmount,
        gasLimit: 21000 // Standard ETH transfer gas limit
      })

      console.log('Waiting for transaction confirmation...')
      await tx.wait()
      console.log('Transaction confirmed:', tx.hash)

    } catch (err) {
      console.error('Detailed send error:', err)
      if (isUserRejection(err)) {
        throw new Error('denied by user')
      }
      throw new Error(`Send failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      {/* Top Wallet Connection Section */}
      <div className="max-w-4xl mx-auto grid grid-cols-2 gap-4 mb-6">
        <button 
          onClick={connectMetamask}
          className={`p-4 rounded-lg text-white text-center transition-colors ${
            metamask.address 
              ? 'bg-orange-600 opacity-50 cursor-not-allowed' 
              : 'bg-orange-500 hover:bg-orange-600'
          }`}
          disabled={!!metamask.address}
        >
          {metamask.address ? 'MetaMask Connected' : 'Connect MetaMask'}
        </button>

        <button 
          onClick={connectPhantom}
          className={`p-4 rounded-lg text-white text-center transition-colors ${
            phantom.address 
              ? 'bg-purple-600 opacity-50 cursor-not-allowed' 
              : 'bg-purple-500 hover:bg-purple-600'
          }`}
          disabled={!!phantom.address}
        >
          {phantom.address ? 'Phantom Connected' : 'Connect Phantom'}
        </button>
      </div>

      {/* Updated Balance Display */}
      {(metamask.address || phantom.address) && (
        <div className="max-w-4xl mx-auto mb-6">
          <div className="bg-gray-800 rounded-lg p-6 text-white">
            <h2 className="text-xl font-bold text-gray-300 mb-4">Total Balances</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-400">Base Chain Total</p>
                <p className="text-2xl font-bold text-blue-400">{getTotals().baseTotal} ETH</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">ETH Chain Total</p>
                <p className="text-2xl font-bold text-blue-400">{getTotals().ethTotal} ETH</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Grand Total</p>
                <p className="text-2xl font-bold text-green-400">{getTotals().grandTotal} ETH</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Cards */}
      {(metamask.address || phantom.address) && (
        <div className="max-w-4xl mx-auto grid grid-cols-2 gap-4 mb-6">
          {metamask.address && (
            <div className="bg-gray-800 rounded-lg p-6 text-white">
              <h2 className="text-xl font-bold text-orange-500 mb-4">MetaMask</h2>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-gray-300">
                    {metamask.address.slice(0, 6)}...{metamask.address.slice(-4)}
                  </p>
                  <button onClick={() => navigator.clipboard.writeText(metamask.address)}
                    className="text-blue-400 hover:text-blue-300 text-sm">
                    Copy
                  </button>
                </div>
                <p className="text-gray-300">Base Chain: {parseFloat(metamask.baseBalance).toFixed(4)} ETH</p>
                <p className="text-gray-300">ETH Chain: {parseFloat(metamask.ethBalance).toFixed(4)} ETH</p>
              </div>
            </div>
          )}

          {phantom.address && (
            <div className="bg-gray-800 rounded-lg p-6 text-white">
              <h2 className="text-xl font-bold text-purple-500 mb-4">Phantom</h2>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-gray-300">
                    {phantom.address.slice(0, 6)}...{phantom.address.slice(-4)}
                  </p>
                  <button onClick={() => navigator.clipboard.writeText(phantom.address)}
                    className="text-blue-400 hover:text-blue-300 text-sm">
                    Copy
                  </button>
                </div>
                <p className="text-gray-300">Base Chain: {parseFloat(phantom.baseBalance).toFixed(4)} ETH</p>
                <p className="text-gray-300">ETH Chain: {parseFloat(phantom.ethBalance).toFixed(4)} ETH</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bridge and Send Section Container */}
      {(metamask.address && phantom.address) && (
        <div className="max-w-4xl mx-auto grid grid-cols-2 gap-4">
          {/* Bridge Section */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6">Bridge ETH</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Bridge Direction</label>
                <select
                  value={transfer.fromChain}
                  onChange={(e) => setTransfer(prev => ({ ...prev, fromChain: e.target.value as 'eth' | 'base' }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="eth">ETH Chain → Base Chain</option>
                  <option value="base">Base Chain → ETH Chain</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount to Bridge</label>
                <input
                  type="number"
                  step="0.0001"
                  value={transfer.amount}
                  onChange={(e) => setTransfer(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-4">Source Split</label>
                <div className="flex items-center space-x-4">
                  <span className="text-purple-400 w-16">Phantom</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={transfer.sliderPosition}
                    onChange={(e) => setTransfer(prev => ({ ...prev, sliderPosition: parseInt(e.target.value) }))}
                    className="flex-grow h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-orange-400 w-16 text-right">MetaMask</span>
                </div>
                <div className="flex justify-between mt-2 text-sm text-gray-400">
                  <span>{(100 - transfer.sliderPosition).toFixed(0)}%</span>
                  <span>{transfer.sliderPosition.toFixed(0)}%</span>
                </div>
              </div>

              {transfer.amount && (
                <>
                  <div className="bg-gray-700 rounded-lg p-4 text-sm text-gray-300 space-y-2">
                    <p>Bridge Preview:</p>
                    <p>Phantom: {((100 - transfer.sliderPosition) * parseFloat(transfer.amount) / 100).toFixed(4)} ETH</p>
                    <p>MetaMask: {((transfer.sliderPosition * parseFloat(transfer.amount) / 100)).toFixed(4)} ETH</p>
                  </div>

                  <div className="bg-gray-700 rounded-lg p-4">
                    <div className="text-center">
                      <p className="text-sm text-gray-400 mb-2">You Will Receive</p>
                      <p className="text-2xl font-bold text-green-400">{getEstimatedReceived()} ETH</p>
                      <p className="text-xs text-gray-500 mt-1">After bridge fees</p>
                    </div>
                  </div>
                </>
              )}

              <button
                onClick={bridgeETH}
                className="w-full bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 transition-colors"
              >
                Bridge ETH
              </button>
            </div>
          </div>

          {/* Send Section */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6">Send ETH</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Select Chain</label>
                <select
                  value={send.selectedChain}
                  onChange={(e) => setSend(prev => ({ ...prev, selectedChain: e.target.value as 'eth' | 'base' }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="base">Base Chain</option>
                  <option value="eth">Ethereum Chain</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount to Send</label>
                <input
                  type="number"
                  step="0.0001"
                  value={send.amount}
                  onChange={(e) => setSend(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Recipient Address</label>
                <input
                  type="text"
                  value={send.recipient}
                  onChange={(e) => setSend(prev => ({ ...prev, recipient: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0x..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-4">Source Split</label>
                <div className="flex items-center space-x-4">
                  <span className="text-purple-400 w-16">Phantom</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={send.sliderPosition}
                    onChange={(e) => setSend(prev => ({ ...prev, sliderPosition: parseInt(e.target.value) }))}
                    className="flex-grow h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-orange-400 w-16 text-right">MetaMask</span>
                </div>
                <div className="flex justify-between mt-2 text-sm text-gray-400">
                  <span>{(100 - send.sliderPosition).toFixed(0)}%</span>
                  <span>{send.sliderPosition.toFixed(0)}%</span>
                </div>
              </div>

              {send.amount && (
                <div className="bg-gray-700 rounded-lg p-4 text-sm text-gray-300 space-y-2">
                  <p>Send Preview:</p>
                  <p>Phantom: {((100 - send.sliderPosition) * parseFloat(send.amount) / 100).toFixed(4)} ETH</p>
                  <p>MetaMask: {((send.sliderPosition * parseFloat(send.amount) / 100)).toFixed(4)} ETH</p>
                </div>
              )}

              <button
                onClick={sendETH}
                className="w-full bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 transition-colors"
              >
                Send ETH
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-4xl mx-auto mt-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
    </div>
  )
}