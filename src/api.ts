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
  id: string; pactId: string; event: NotificationEvent
  message: string; forRole: 'sender' | 'receiver' | 'both'
  createdAt: string; read: boolean
}

// ─── Pact API ─────────────────────────────────────────────────────────────────

export const fetchAllPacts  = async (): Promise<Pact[]> =>
  (await api.get<{ data: Pact[] }>('/pact/all')).data.data

export const fetchPactById  = async (id: string): Promise<Pact> =>
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
const ARC_USDC_ADDRESS = '0x09D1fA26bF91A7d882f2De2a89f3d9AA67F8F8c'
const ESCROW_ADDRESS   = '0xbec4cdc622c45ad9974d4ef1a665e77bbdd68bb9'

// ─── Helper: send USDC via MetaMask ──────────────────────────────────────────
const sendUSDC = async (from: string, to: string, amount: string): Promise<string> => {
  const eth = (window as any).ethereum
  if (!eth) throw new Error('MetaMask not found. Please install MetaMask and add Arc Testnet.')

  // Ensure correct network before sending
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x4CEED2' }] })
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: '0x4CEED2',
        chainName: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: ['https://rpc.testnet.arc.network'],
        blockExplorerUrls: ['https://testnet.arcscan.app'],
      }] })
    }
  }

  const amountInUnits = BigInt(Math.round(parseFloat(amount) * 1_000_000))
  // ... rest stays the same

  const amountInUnits = BigInt(Math.round(parseFloat(amount) * 1_000_000))
  const selector        = '0xa9059cbb'
  const paddedRecipient = to.toLowerCase().replace('0x', '').padStart(64, '0')
  const paddedAmount    = amountInUnits.toString(16).padStart(64, '0')
  const data            = `${selector}${paddedRecipient}${paddedAmount}`

  try {
    const txHash: string = await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: ARC_USDC_ADDRESS, data }],
    })
    if (!txHash) throw new Error('Transaction failed — no hash returned')
    return txHash
  } catch (err: any) {
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

// ─── Notifications (wallet-scoped) ────────────────────────────────────────────

export const fetchNotifications = async (wallet?: string): Promise<ArcNotification[]> =>
  (await api.get<{ data: ArcNotification[] }>(`/pact/notifications${wallet ? `?wallet=${wallet}` : ''}`)).data.data

export const markAllRead = async (): Promise<void> => { await api.post('/pact/notifications/read', {}) }

// ─── Error helper ─────────────────────────────────────────────────────────────

export const getErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) return err.response?.data?.message ?? err.message ?? 'Request failed'
  return err instanceof Error ? err.message : 'Something went wrong'
}
