import axios from 'axios'

export const api = axios.create({
  baseURL: 'https://arcpact-backend-production.up.railway.app/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type PactStatus = 'CREATED' | 'ACCEPTED' | 'FUNDS_LOCKED' | 'DISPUTED' | 'COMPLETED' | 'REFUNDED'

export interface Pact {
  id:              string
  senderAddress:   string
  receiverAddress: string
  amount:          string
  status:          PactStatus
  createdAt:       string
  updatedAt:       string
  receiverAccepted:       boolean
  receiverReleaseRequest: boolean
  senderApproval:         boolean
  senderRefundRequest:    boolean
  receiverApproval:       boolean
  disputedBy:  string | null
  disputeNote: string | null
}

export interface CreatePactPayload {
  callerAddress:   string
  receiverAddress: string
  amount:          string
}

export type PactRole = 'sender' | 'receiver' | 'viewer'

export type NotificationEvent =
  | 'PACT_CREATED' | 'PACT_ACCEPTED' | 'FUNDS_LOCKED'
  | 'PAYMENT_REQUESTED' | 'REFUND_REQUESTED'
  | 'PAYMENT_APPROVED'  | 'REFUND_APPROVED'
  | 'DISPUTE_RAISED'

export interface ArcNotification {
  id: string
  pactId: string
  event: NotificationEvent
  message: string
  forRole: 'sender' | 'receiver' | 'both'
  createdAt: string
  read: boolean
}

// ─── Pact API ─────────────────────────────────────────────────────────────────

export const fetchAllPacts = async (): Promise<Pact[]> =>
  (await api.get<{ data: Pact[] }>('/pact/all')).data.data

export const fetchPactById = async (id: string): Promise<Pact> =>
  (await api.get<{ data: Pact }>(`/pact/${id}`)).data.data

export const fetchPactRole = async (pactId: string, wallet: string): Promise<{ role: PactRole; pact: Pact }> =>
  (await api.get<{ data: { role: PactRole; pact: Pact } }>(`/pact/role?pactId=${pactId}&wallet=${wallet}`)).data.data

export const createPact = async (p: CreatePactPayload): Promise<Pact> =>
  (await api.post<{ data: Pact }>('/pact/create', { ...p, amount: String(p.amount) })).data.data

export const acceptPact = async (pactId: string, callerAddress: string): Promise<Pact> =>
  (await api.post<{ data: Pact }>('/pact/accept', { pactId, callerAddress })).data.data

export const cancelPact = async (pactId: string, callerAddress: string): Promise<Pact> =>
  (await api.post<{ data: Pact }>('/pact/cancel', { pactId, callerAddress })).data.data

// ─── Arc testnet config ───────────────────────────────────────────────────────
const ESCROW_ADDRESS = '0xbec4cdc622c45ad9974d4ef1a665e77bbdd68bb9'
const USDC_CONTRACT  = '0x3600000000000000000000000000000000000000'
const ARC_CHAIN_ID   = '0x4CE892' // 5042002 in hex — DO NOT CHANGE THIS

// ─── Helper: send USDC via MetaMask ──────────────────────────────────────────
const sendUSDC = async (from: string, to: string, amount: string): Promise<string> => {
  const eth = (window as any).ethereum
  console.log('sendUSDC called', { from, to, amount })  // ADD THIS
  if (!eth) throw new Error('MetaMask not found. Please install MetaMask and add Arc Testnet.')

  try {
    console.log('Attempting network switch...')  // ADD THIS
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID }] })
    console.log('Network switch successful')  // ADD THIS
  } catch (err: any) {
    console.log('Network switch error:', err?.code, err?.message)
    if (err?.code === 4902 || err?.code === -32603) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ARC_CHAIN_ID,
          chainName: 'Arc Testnet',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: ['https://arc-testnet.drpc.org'],
          blockExplorerUrls: ['https://testnet.arcscan.app'],
        }],
      })
    } else {
      throw err
    }
  }

  console.log('Building transaction...')  // ADD THIS
  const amountInUnits = BigInt(Math.round(parseFloat(amount) * 1e6))
  const paddedTo     = to.replace('0x', '').toLowerCase().padStart(64, '0')
  const paddedAmount = amountInUnits.toString(16).padStart(64, '0')
  const data         = '0xa9059cbb' + paddedTo + paddedAmount

  console.log('Sending tx:', { from, to: USDC_CONTRACT, data })  // ADD THIS

  try {
    const txHash: string = await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: USDC_CONTRACT, data, value: '0x0' }],
    })
    console.log('txHash:', txHash)  // ADD THIS
    if (!txHash) throw new Error('Transaction failed — no hash returned')
    return txHash
  } catch (err: any) {
    console.log('Send error:', err?.code, err?.message)  // ADD THIS
    if (err?.code === 4001) throw new Error('Transaction rejected in MetaMask')
    throw new Error(`MetaMask transfer failed: ${err?.message ?? 'Unknown error'}`)
  }
}

// ─── lockFunds ────────────────────────────────────────────────────────────────
export const lockFunds = async (pactId: string, callerAddress: string, amount: string): Promise<Pact> => {
  await sendUSDC(callerAddress, ESCROW_ADDRESS, amount)
  return (await api.post<{ data: Pact }>('/pact/lock', { pactId, callerAddress })).data.data
}

// ─── approveRelease ───────────────────────────────────────────────────────────
export const approveRelease = async (pactId: string, callerAddress: string, amount: string, receiverAddress: string): Promise<Pact> => {
  await sendUSDC(callerAddress, receiverAddress, amount)
  return (await api.post<{ data: Pact }>('/pact/approve-release', { pactId, callerAddress })).data.data
}

// ─── approveRefund ────────────────────────────────────────────────────────────
export const approveRefund = async (pactId: string, callerAddress: string, amount: string, senderAddress: string): Promise<Pact> => {
  await sendUSDC(callerAddress, senderAddress, amount)
  return (await api.post<{ data: Pact }>('/pact/approve-refund', { pactId, callerAddress })).data.data
}

export const requestRelease = async (pactId: string, callerAddress: string): Promise<Pact> =>
  (await api.post<{ data: Pact }>('/pact/request-release', { pactId, callerAddress })).data.data

export const requestRefund = async (pactId: string, callerAddress: string): Promise<Pact> =>
  (await api.post<{ data: Pact }>('/pact/request-refund', { pactId, callerAddress })).data.data

export const raiseDispute = async (pactId: string, callerAddress: string, note?: string): Promise<Pact> =>
  (await api.post<{ data: Pact }>('/pact/dispute', { pactId, callerAddress, note: note ?? '' })).data.data

// ─── Notifications ────────────────────────────────────────────────────────────

export const fetchNotifications = async (wallet?: string): Promise<ArcNotification[]> =>
  (await api.get<{ data: ArcNotification[] }>(`/pact/notifications${wallet ? `?wallet=${wallet}` : ''}`)).data.data

export const markAllRead = async (): Promise<void> => {
  await api.post('/pact/notifications/read', {})
}

// ─── Error helper ─────────────────────────────────────────────────────────────

export const getErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) return err.response?.data?.message ?? err.message ?? 'Request failed'
  return err instanceof Error ? err.message : 'Something went wrong'
}
