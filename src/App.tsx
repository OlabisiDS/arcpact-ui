import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Link, useNavigate, useParams } from 'react-router-dom'
import {
  fetchAllPacts, fetchPactById, fetchPactRole, createPact,
  acceptPact, lockFunds, cancelPact, requestRelease, approveRelease,
  requestRefund, approveRefund, raiseDispute,
  fetchNotifications, markAllRead, getErrorMessage,
  type Pact, type PactStatus, type PactRole, type ArcNotification,
} from './api'

// ─────────────────────────────────────────────────────────────────────────────
// Shared hooks & utilities
// ─────────────────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    const s = localStorage.getItem('arc_theme'); return s ? s === 'dark' : true
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('arc_theme', dark ? 'dark' : 'light')
  }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }
let _tid = 0
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((msg: string, type: Toast['type'] = 'success', dur = 4000) => {
    const id = ++_tid
    setToasts(p => [...p, { id, message: msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), dur)
  }, [])
  return { toasts, push }
}

// Arc Testnet chain config for MetaMask
const ARC_TESTNET_CHAIN = {
  chainId: '0x4CEED2',
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.arc.network'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
}

async function switchToArcTestnet(eth: any) {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] })
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_TESTNET_CHAIN] })
    }
  }
}

function useWallet() {
  const [address, setAddress] = useState<string | null>(() => localStorage.getItem('arc_wallet'))
  const connect = useCallback(async (): Promise<string | null> => {
    const eth = (window as any).ethereum
    if (eth) {
      try {
        const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
        if (accounts[0]) {
          await switchToArcTestnet(eth).catch(() => {})
          setAddress(accounts[0]); localStorage.setItem('arc_wallet', accounts[0]); return accounts[0]
        }
      } catch { /* rejected */ }
    }
    const existing = localStorage.getItem('arc_wallet')
    if (existing) { setAddress(existing); return existing }
    const bytes = crypto.getRandomValues(new Uint8Array(20))
    const hex = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    setAddress(hex); localStorage.setItem('arc_wallet', hex); return hex
  }, [])
  const disconnect = useCallback(() => { setAddress(null); localStorage.removeItem('arc_wallet') }, [])
  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth) return
    const h = (a: string[]) => {
      if (a[0]) { setAddress(a[0]); localStorage.setItem('arc_wallet', a[0]) }
      else { setAddress(null); localStorage.removeItem('arc_wallet') }
    }
    eth.on('accountsChanged', h); return () => eth.removeListener?.('accountsChanged', h)
  }, [])
  return { address, connect, disconnect }
}

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'w-3 h-3 border', md: 'w-4 h-4 border-2', lg: 'w-6 h-6 border-2' }[size]
  return <span className={`${s} rounded-full border-t-transparent animate-spin inline-block border-current`} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Status config
// ─────────────────────────────────────────────────────────────────────────────

type SC = { label: string; desc: string; step: number; bar: string; badge: string; badgeDark: string }
const STATUS: Record<PactStatus, SC> = {
  CREATED:      { label:'Awaiting Acceptance', desc:'Receiver needs to accept the terms',             step:1, bar:'status-bar-created',   badge:'bg-slate-100 text-slate-600 border-slate-200',         badgeDark:'bg-slate-800/60 text-slate-300 border-slate-700/60'    },
  ACCEPTED:     { label:'Awaiting Funds',       desc:'Accepted. Sender needs to lock funds.',          step:2, bar:'status-bar-accepted',  badge:'bg-blue-50 text-blue-700 border-blue-200',             badgeDark:'bg-blue-500/10 text-blue-300 border-blue-500/30'       },
  FUNDS_LOCKED: { label:'In Escrow',            desc:'Funds held. Both must agree to settle.',         step:3, bar:'status-bar-locked',    badge:'bg-amber-50 text-amber-700 border-amber-200',          badgeDark:'bg-amber-500/10 text-amber-300 border-amber-500/30'    },
  DISPUTED:     { label:'Disputed',             desc:'Dispute raised. Can still be resolved.',         step:3, bar:'status-bar-disputed',  badge:'bg-orange-50 text-orange-700 border-orange-200',       badgeDark:'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  COMPLETED:    { label:'Released',             desc:'Funds successfully released to receiver',        step:4, bar:'status-bar-completed', badge:'bg-emerald-50 text-emerald-700 border-emerald-200',     badgeDark:'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'},
  REFUNDED:     { label:'Refunded',             desc:'Funds returned to sender',                       step:4, bar:'status-bar-refunded',  badge:'bg-rose-50 text-rose-600 border-rose-200',             badgeDark:'bg-rose-500/10 text-rose-300 border-rose-500/30'       },
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI components
// ─────────────────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div ref={ref} onClick={e => { if (e.target === ref.current) onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md px-4">
      {children}
    </div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-md animate-slide-up dark:glass rounded-2xl dark:shadow-card bg-white dark:bg-transparent border border-slate-200 dark:border-white/10 p-7 shadow-2xl">
        {children}
      </div>
    </Overlay>
  )
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end max-w-sm">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'animate-slide-up flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium shadow-2xl',
          t.type === 'error' ? 'bg-rose-600 text-white'
          : t.type === 'info' ? 'bg-slate-800 text-white border border-white/10'
          : 'dark:bg-arc-700 bg-slate-900 text-white border dark:border-white/10'
        )}>
          {t.type === 'success' && <svg className="w-4 h-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          {t.type === 'error'   && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>}
          {t.type === 'info'    && <svg className="w-4 h-4 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Navbar
// ─────────────────────────────────────────────────────────────────────────────

const N_ICON: Record<string, string> = {
  PACT_CREATED:'🔵', PACT_ACCEPTED:'✅', FUNDS_LOCKED:'🔒',
  PAYMENT_REQUESTED:'💰', REFUND_REQUESTED:'↩️',
  PAYMENT_APPROVED:'🎉', REFUND_APPROVED:'↩️', DISPUTE_RAISED:'⚠️'
}

function NotifPanel({ wallet, onClose }: { wallet: string | null; onClose: () => void }) {
  const [notifs, setNotifs] = useState<ArcNotification[]>([])
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchNotifications(wallet ?? undefined)
      .then(d => { setNotifs(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [wallet])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 50)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const unread = notifs.filter(n => !n.read).length

  return (
    <div ref={ref} className="absolute right-0 top-full mt-2 w-80 dark:bg-arc-800 bg-white border dark:border-white/10 border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden animate-slide-up">
      <div className="px-4 py-3.5 border-b dark:border-white/[0.07] border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">Activity</span>
          {unread > 0 && <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{unread}</span>}
        </div>
        {unread > 0 && (
          <button onClick={async () => { await markAllRead().catch(() => {}); setNotifs(p => p.map(n => ({ ...n, read: true }))) }}
            className="text-[11px] text-slate-400 hover:text-white transition-colors">Mark all read</button>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading
          ? <div className="flex justify-center py-10"><Spinner /></div>
          : notifs.length === 0
            ? <p className="py-10 text-center text-xs text-slate-500">{wallet ? 'No activity yet' : 'Connect wallet to see activity'}</p>
            : notifs.map(n => (
              <div key={n.id} className={cn('px-4 py-3.5 border-b dark:border-white/[0.04] border-slate-50 last:border-0', !n.read && 'dark:bg-blue-500/[0.06] bg-blue-50/50')}>
                <div className="flex items-start gap-2.5">
                  <span className="text-sm shrink-0 mt-0.5">{N_ICON[n.event] ?? '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs leading-relaxed', n.read ? 'text-slate-500' : 'text-slate-800 dark:text-slate-200 font-medium')}>{n.message}</p>
                    <Link to={`/pact/${n.pactId}`} onClick={onClose}
                      className="text-[10px] text-blue-400 hover:text-blue-300 mt-0.5 block">
                      {new Date(n.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · #{n.pactId.slice(0, 6).toUpperCase()} →
                    </Link>
                  </div>
                  {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
                </div>
              </div>
            ))
        }
      </div>
    </div>
  )
}

function Navbar({ walletAddress, connectWallet, disconnect, dark, toggleTheme, unreadCount, refreshUnread }:
  { walletAddress: string|null; connectWallet: ()=>Promise<string|null>; disconnect: ()=>void; dark: boolean; toggleTheme: ()=>void; unreadCount: number; refreshUnread: ()=>void }
) {
  const [notifOpen, setNotifOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-40 dark:bg-arc-900/90 bg-white/90 backdrop-blur-xl border-b dark:border-white/[0.07] border-slate-200">
      <div className="max-w-6xl mx-auto px-5 h-[60px] flex items-center justify-between">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-glow-sm group-hover:bg-blue-700 transition-colors">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-base font-black text-slate-900 dark:text-white tracking-tight">Arc</span>
            <span className="text-base font-black text-blue-500 tracking-tight">Pact</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 dark:bg-white/[0.05] bg-slate-100 rounded-full px-2.5 py-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Testnet</span>
          </div>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
          <Link to="/" className="px-3 py-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors">Dashboard</Link>
          <Link to="/pacts" className="px-3 py-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors">My Pacts</Link>
          <Link to="/new" className="px-3 py-1.5 text-sm font-medium text-blue-500 hover:text-blue-400 rounded-lg hover:bg-blue-500/10 transition-colors">+ New Pact</Link>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5">
          {/* Theme */}
          <button onClick={toggleTheme} className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white dark:hover:bg-white/[0.06] hover:bg-slate-100 transition-colors">
            {dark
              ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg>
            }
          </button>

          {/* Notif bell */}
          <div className="relative">
            <button onClick={() => { setNotifOpen(o => !o); refreshUnread() }}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white dark:hover:bg-white/[0.06] hover:bg-slate-100 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && <NotifPanel wallet={walletAddress} onClose={() => setNotifOpen(false)} />}
          </div>

          {/* Wallet */}
          {walletAddress
            ? <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 dark:bg-white/[0.05] bg-slate-100 border dark:border-white/[0.08] border-slate-200 rounded-xl px-3 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow" />
                  <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 font-medium">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
                </div>
                <button onClick={disconnect} className="text-[11px] font-medium text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors px-1">Disconnect</button>
              </div>
            : <button onClick={connectWallet} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-xl btn-press transition-colors shadow-glow-sm">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9"/></svg>
                Connect Wallet
              </button>
          }
        </div>
      </div>
    </nav>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pact action modals
// ─────────────────────────────────────────────────────────────────────────────

function DisputeModal({ onConfirm, onClose }: { onConfirm: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('')
  return (
    <Modal onClose={onClose}>
      <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-5">
        <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Raise a dispute?</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">Funds remain locked. Both parties can still resolve by agreeing to release or refund.</p>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
        placeholder="Describe the issue (optional)…"
        className="w-full px-4 py-3 mb-5 text-sm rounded-xl dark:bg-white/[0.04] bg-slate-50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-white/10 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none" />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 dark:bg-white/[0.05] bg-slate-100 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">Cancel</button>
        <button onClick={() => onConfirm(note)} className="flex-1 py-2.5 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl btn-press transition-colors">Raise Dispute</button>
      </div>
    </Modal>
  )
}

interface ConfirmProps { title: string; body: string; icon: 'release'|'refund'|'lock'|'accept'; onConfirm: ()=>void; onCancel: ()=>void; amount?: string; recipient?: string; isDisputed?: boolean }

function ConfirmModal({ title, body, icon, onConfirm, onCancel, amount, recipient, isDisputed }: ConfirmProps) {
  const btnMap = { release:'bg-emerald-600 hover:bg-emerald-700', refund:'bg-rose-600 hover:bg-rose-700', lock:'bg-blue-600 hover:bg-blue-700', accept:'bg-blue-600 hover:bg-blue-700' }
  const lblMap = { release:'Confirm Release', refund:'Confirm Refund', lock:'Lock Funds', accept:'Accept Pact' }
  return (
    <Modal onClose={onCancel}>
      {isDisputed && (
        <div className="flex items-start gap-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 mb-5">
          <svg className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
          <p className="text-xs font-medium text-orange-300">This pact is disputed. Are you sure you want to proceed?</p>
        </div>
      )}
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">{body}</p>
      {(amount || recipient) && (
        <div className="dark:bg-white/[0.03] bg-slate-50 rounded-xl p-4 mb-6 space-y-3 border border-slate-200 dark:border-white/[0.07]">
          {amount && <div className="flex justify-between"><span className="text-xs text-slate-400">Amount</span><span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">{parseFloat(amount).toFixed(2)} <span className="text-xs font-normal text-slate-400">USDC</span></span></div>}
          {recipient && <div className="flex justify-between items-center"><span className="text-xs text-slate-400">Address</span><span className="font-mono text-xs text-slate-600 dark:text-slate-300 dark:bg-white/[0.05] bg-white px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10">{recipient.slice(0, 10)}…{recipient.slice(-6)}</span></div>}
        </div>
      )}
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 dark:bg-white/[0.05] bg-slate-100 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">Cancel</button>
        <button onClick={onConfirm} className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl btn-press transition-colors ${btnMap[icon]}`}>{lblMap[icon]}</button>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LifecycleTrack
// ─────────────────────────────────────────────────────────────────────────────

function LifecycleTrack({ status }: { status: PactStatus }) {
  const step = STATUS[status].step
  const isRefunded = status === 'REFUNDED', isDisputed = status === 'DISPUTED'
  const labels = ['Created', 'Accepted', isDisputed ? 'Disputed' : 'In Escrow', isRefunded ? 'Refunded' : 'Released']
  return (
    <div className="flex items-center">
      {labels.map((label, i) => {
        const n = i + 1, past = n < step, cur = n === step
        const dot = past
          ? (isRefunded && n === 4 ? 'bg-rose-500' : isDisputed && n === 3 ? 'bg-orange-500' : 'bg-emerald-500')
          : cur ? (isDisputed ? 'bg-orange-500' : 'bg-blue-500') : 'dark:bg-white/10 bg-slate-200'
        const txt = cur ? (isDisputed ? 'text-orange-400' : 'text-blue-400') : past ? 'text-slate-500' : 'dark:text-slate-600 text-slate-400'
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all', past || cur ? 'text-white' : 'dark:text-slate-500 text-slate-400', dot)}>
                {past ? <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg> : n}
              </div>
              <span className={cn('text-[9px] font-medium', txt)}>{label}</span>
            </div>
            {i < 3 && <div className={cn('flex-1 h-px mx-1 mb-3.5', n < step ? 'dark:bg-white/20 bg-slate-300' : 'dark:bg-white/[0.05] bg-slate-100')} />}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PactActions — the role-aware action panel
// ─────────────────────────────────────────────────────────────────────────────

function PactActions({ pact, role, walletAddress, onAction, loading }: {
  pact: Pact; role: PactRole; walletAddress: string | null
  onAction: (pactId: string, action: string) => Promise<void>; loading: boolean
}) {
  const [cs, setCs] = useState<{ action: string; title: string; body: string; icon: 'release'|'refund'|'lock'|'accept'; amount?: string; recipient?: string } | null>(null)
  const [dispOpen, setDispOpen] = useState(false)

  const isDisputed = pact.status === 'DISPUTED'
  const locked = pact.status === 'FUNDS_LOCKED' || isDisputed

  // Role-based action availability — frontend primary enforcement
  const acts = {
    accept:         role === 'receiver' && pact.status === 'CREATED',
    cancel:         role === 'sender'   && pact.status === 'CREATED',
    lock:           role === 'sender'   && pact.status === 'ACCEPTED',
    requestRelease: role === 'receiver' && locked && !pact.receiverReleaseRequest,
    approveRelease: role === 'sender'   && locked && pact.receiverReleaseRequest && !pact.senderApproval,
    requestRefund:  role === 'sender'   && locked && !pact.senderRefundRequest,
    approveRefund:  role === 'receiver' && locked && pact.senderRefundRequest && !pact.receiverApproval,
    dispute:        (role === 'sender' || role === 'receiver') && pact.status === 'FUNDS_LOCKED',
  }
  const hasAct = Object.values(acts).some(Boolean)
  const isTerminal = pact.status === 'COMPLETED' || pact.status === 'REFUNDED'

  const doConfirm = async () => {
    if (!cs) return; const a = cs.action; setCs(null); await onAction(pact.id, a)
  }

  if (!walletAddress) {
    return <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">Connect your wallet to take action</p>
  }

  if (role === 'viewer') {
    return <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">You are viewing this pact as an observer</p>
  }

  return (
    <>
      {cs && <ConfirmModal {...cs} isDisputed={isDisputed} onConfirm={doConfirm} onCancel={() => setCs(null)} />}
      {dispOpen && <DisputeModal onConfirm={note => { setDispOpen(false); onAction(pact.id, `dispute:${note}`) }} onClose={() => setDispOpen(false)} />}

      {loading
        ? <div className="flex items-center justify-center gap-2 py-4 text-slate-400"><Spinner size="sm" /><span className="text-sm">Processing on Arc…</span></div>
        : isTerminal
          ? <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">This pact is closed</p>
          : !hasAct
            ? <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">
                {pact.status === 'CREATED' ? 'Share the pact link with your receiver to get started' : 'Waiting for counterparty action'}
              </p>
            : (
              <div className="flex gap-3 flex-wrap">
                {acts.accept         && <button onClick={() => setCs({ action:'accept', title:'Accept this pact?', body:'You agree to the escrow terms. The sender can then lock funds.', icon:'accept' })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press disabled:opacity-40 transition-colors">Accept Pact</button>}
                {acts.cancel         && <button onClick={() => setCs({ action:'cancel', title:'Cancel this pact?', body:'The pact will be closed. No funds have been moved.', icon:'refund' })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl btn-press hover:bg-rose-600 hover:text-white hover:border-rose-600 disabled:opacity-40 transition-colors">Cancel Pact</button>}
                {acts.lock           && <button onClick={() => setCs({ action:'lock', title:'Fund the escrow?', body:'USDC will be locked until both parties agree to settle.', icon:'lock', amount:pact.amount })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press disabled:opacity-40 transition-colors">Fund Escrow</button>}
                {acts.requestRelease && <button onClick={() => setCs({ action:'request-release', title:'Request payment?', body:"Signal you've delivered. Sender will approve.", icon:'release', amount:pact.amount })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl btn-press hover:bg-emerald-600 hover:text-white hover:border-emerald-600 disabled:opacity-40 transition-colors">Request Payment</button>}
                {acts.approveRelease && <button onClick={() => setCs({ action:'approve-release', title:'Approve payment?', body:'Releases funds to receiver. Cannot be undone.', icon:'release', amount:pact.amount, recipient:pact.receiverAddress })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl btn-press hover:bg-emerald-600 hover:text-white hover:border-emerald-600 disabled:opacity-40 transition-colors">Approve Payment</button>}
                {acts.requestRefund  && <button onClick={() => setCs({ action:'request-refund', title:'Request a refund?', body:'Receiver will be asked to approve.', icon:'refund', amount:pact.amount })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl btn-press hover:bg-rose-600 hover:text-white hover:border-rose-600 disabled:opacity-40 transition-colors">Request Refund</button>}
                {acts.approveRefund  && <button onClick={() => setCs({ action:'approve-refund', title:'Approve refund?', body:'Returns funds to sender. Cannot be undone.', icon:'refund', amount:pact.amount, recipient:pact.senderAddress })} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl btn-press hover:bg-rose-600 hover:text-white hover:border-rose-600 disabled:opacity-40 transition-colors">Approve Refund</button>}
                {acts.dispute        && <button onClick={() => setDispOpen(true)} disabled={loading} className="py-3 px-4 text-sm font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-xl btn-press hover:bg-orange-500 hover:text-white hover:border-orange-500 disabled:opacity-40 transition-colors">Dispute</button>}
              </div>
            )
      }
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PactCard — compact list card
// ─────────────────────────────────────────────────────────────────────────────

function PactCard({ pact, walletAddress }: { pact: Pact; walletAddress: string | null }) {
  const st = STATUS[pact.status]
  const walletLower = walletAddress?.toLowerCase()
  const role: PactRole = walletLower === pact.senderAddress.toLowerCase() ? 'sender'
    : walletLower === pact.receiverAddress.toLowerCase() ? 'receiver' : 'viewer'
  const isTerminal = pact.status === 'COMPLETED' || pact.status === 'REFUNDED'

  // Show attention dot if action is required from connected wallet
  const locked = pact.status === 'FUNDS_LOCKED' || pact.status === 'DISPUTED'
  const needsAction =
    (role === 'receiver' && pact.status === 'CREATED') ||
    (role === 'sender'   && pact.status === 'ACCEPTED') ||
    (role === 'sender'   && locked && pact.receiverReleaseRequest && !pact.senderApproval) ||
    (role === 'receiver' && locked && pact.senderRefundRequest && !pact.receiverApproval)

  return (
    <Link to={`/pact/${pact.id}`}
      className={cn(
        'group relative rounded-2xl border flex flex-col overflow-hidden transition-all duration-200 hover:scale-[1.01]',
        'dark:bg-arc-800 bg-white',
        isTerminal
          ? 'dark:border-white/[0.06] border-slate-200 opacity-70'
          : 'dark:border-white/[0.08] border-slate-200 dark:shadow-card dark:hover:shadow-card-hover dark:hover:border-blue-500/30 shadow-card-light hover:shadow-card-light-hover'
      )}>
      <div className={cn('h-[3px] w-full', st.bar)} />

      {needsAction && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-blue-500 animate-pulse-slow" title="Action required" />
      )}

      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">#{pact.id.slice(0, 8).toUpperCase()}</span>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', 'dark:' + st.badgeDark, st.badge)}>{st.label}</span>
            </div>
            <p className="text-[11px] text-slate-400">{new Date(pact.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{parseFloat(pact.amount).toFixed(2)}</div>
            <div className="text-[10px] font-semibold text-slate-400 tracking-widest uppercase">USDC</div>
          </div>
        </div>

        <div className="space-y-1.5 mb-3">
          {[['From', pact.senderAddress], ['To', pact.receiverAddress]].map(([lbl, addr]) => (
            <div key={lbl} className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-slate-400 w-6 shrink-0">{lbl}</span>
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">{addr.slice(0, 10)}…{addr.slice(-6)}</span>
            </div>
          ))}
        </div>

        {role !== 'viewer' && (
          <div className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
            role === 'sender' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20')}>
            <div className={cn('w-1.5 h-1.5 rounded-full', role === 'sender' ? 'bg-blue-400' : 'bg-emerald-400')} />
            {role}
          </div>
        )}
      </div>
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Home
// ─────────────────────────────────────────────────────────────────────────────

function HomePage({ walletAddress, connectWallet, pushToast }: {
  walletAddress: string | null
  connectWallet: () => Promise<string | null>
  pushToast: (msg: string, type?: Toast['type']) => void
}) {
  const [pacts, setPacts] = useState<Pact[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await fetchAllPacts()
      setPacts([...data].reverse())
    } catch { if (!silent) pushToast('Could not load pacts', 'error') }
    finally { if (!silent) setLoading(false) }
  }, [pushToast])

  useEffect(() => { load() }, [load])
  useEffect(() => { const id = setInterval(() => load(true), 4000); return () => clearInterval(id) }, [load])

  const myPacts = walletAddress
    ? pacts.filter(p => p.senderAddress.toLowerCase() === walletAddress.toLowerCase() || p.receiverAddress.toLowerCase() === walletAddress.toLowerCase())
    : []

  const activePacts  = myPacts.filter(p => ['CREATED', 'ACCEPTED', 'FUNDS_LOCKED', 'DISPUTED'].includes(p.status))
  const settledTotal = pacts.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + parseFloat(p.amount), 0)
  const lockedTotal  = pacts.filter(p => p.status === 'FUNDS_LOCKED' || p.status === 'DISPUTED').reduce((s, p) => s + parseFloat(p.amount), 0)

  return (
    <div className="max-w-6xl mx-auto px-5 py-10">

      {/* Hero section */}
      <section className="relative overflow-hidden rounded-3xl mb-10 dark:bg-arc-850 bg-white border dark:border-white/[0.07] border-slate-200 dark:shadow-card shadow-card-light">
        <div className="absolute inset-0 bg-hero-radial pointer-events-none" />
        <div className="absolute inset-0 hero-grid pointer-events-none opacity-40" />
        <div className="absolute top-0 left-0 right-0 h-px dark:bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />

        <div className="relative px-8 pt-12 pb-10">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Arc Network · Testnet</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-4">
            <span className="text-slate-900 dark:text-white">Escrow.</span>{' '}
            <span className="gradient-text">Without trust.</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mb-8 leading-relaxed">
            Lock USDC on-chain. Funds release only when both sender and receiver agree. Transparent, programmable, unstoppable.
          </p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate('/new')}
              className="flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors shadow-glow-md">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              Create New Pact
            </button>
            <button onClick={() => navigate('/pacts')}
              className="flex items-center gap-2 px-6 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 dark:bg-white/[0.06] bg-slate-100 border dark:border-white/10 border-slate-200 rounded-xl btn-press hover:dark:bg-white/10 hover:bg-slate-200 transition-colors">
              View My Pacts
            </button>
            {!walletAddress && (
              <button onClick={connectWallet}
                className="flex items-center gap-2 px-6 py-3 text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors">
                Connect Wallet →
              </button>
            )}
          </div>
        </div>

        {/* Live stats */}
        <div className="relative border-t dark:border-white/[0.06] border-slate-100 px-8 py-5 grid grid-cols-3 gap-6">
          {[
            { label: 'Total Settled', value: `${settledTotal.toFixed(0)} USDC` },
            { label: 'In Escrow',     value: `${lockedTotal.toFixed(0)} USDC` },
            { label: 'Total Pacts',   value: pacts.length.toString() },
          ].map(s => (
            <div key={s.label}>
              <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">{s.value}</p>
              <p className="text-[11px] text-slate-400 uppercase tracking-widest mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        {[
          { icon: '🔒', title: 'Non-custodial', desc: 'No intermediary holds your funds. Smart contract enforced.' },
          { icon: '🤝', title: 'Dual-party consent', desc: 'Funds move only when both parties explicitly agree.' },
          { icon: '⚖️', title: 'Built-in disputes', desc: 'Raise a dispute at any time. Funds stay locked until resolved.' },
        ].map(f => (
          <div key={f.title} className="feature-card dark:bg-arc-800 bg-white border dark:border-white/[0.07] border-slate-200 rounded-2xl p-5 dark:shadow-card shadow-card-light transition-all duration-300">
            <span className="text-2xl mb-3 block">{f.icon}</span>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{f.title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* My active pacts preview */}
      {walletAddress && activePacts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active Pacts Requiring Attention</h2>
            <Link to="/pacts" className="text-xs text-blue-400 hover:text-blue-300">View all →</Link>
          </div>
          {loading
            ? <div className="flex justify-center py-8"><Spinner /></div>
            : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {activePacts.slice(0, 3).map(p => <PactCard key={p.id} pact={p} walletAddress={walletAddress} />)}
              </div>
          }
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: New Pact
// ─────────────────────────────────────────────────────────────────────────────

function NewPactPage({ walletAddress, connectWallet, pushToast }: {
  walletAddress: string | null
  connectWallet: () => Promise<string | null>
  pushToast: (msg: string, type?: Toast['type']) => void
}) {
  const [receiver, setReceiver] = useState('')
  const [amount, setAmount]     = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  const isValid = !!walletAddress && receiver.trim().length === 42 && parseFloat(amount) > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || !walletAddress) return
    setLoading(true)
    try {
      const pact = await createPact({ callerAddress: walletAddress, receiverAddress: receiver.trim(), amount })
      pushToast('Pact created — share with your receiver', 'success')
      navigate(`/pact/${pact.id}`)
    } catch (err) { pushToast(getErrorMessage(err), 'error') }
    finally { setLoading(false) }
  }

  const inputCls = "w-full px-4 py-3 text-sm rounded-xl border dark:bg-white/[0.04] bg-white dark:text-slate-200 text-slate-800 dark:border-white/10 border-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50 transition-all"

  return (
    <div className="max-w-2xl mx-auto px-5 py-10">
      <div className="mb-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-4">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
          Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Create a New Pact</h1>
        <p className="text-slate-400 mt-1">Set up an escrow agreement between two wallets</p>
      </div>

      <div className="dark:bg-arc-800 bg-white rounded-2xl border dark:border-white/[0.08] border-slate-200 dark:shadow-card shadow-card-light overflow-hidden">
        <div className="px-7 py-5 border-b dark:border-white/[0.07] border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-glow-sm">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Pact Details</h2>
              <p className="text-xs text-slate-400 mt-0.5">Your connected wallet will be the sender</p>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="px-7 py-6 space-y-5">
          {/* Sender display */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Your address (sender)</label>
            {walletAddress
              ? <div className="flex items-center gap-2.5 px-4 py-3 dark:bg-white/[0.03] bg-slate-50 border dark:border-white/[0.07] border-slate-200 rounded-xl">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow shrink-0" />
                  <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{walletAddress.slice(0, 18)}…{walletAddress.slice(-8)}</span>
                </div>
              : <button type="button" onClick={connectWallet}
                  className="w-full px-4 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors">
                  Connect Wallet to Continue
                </button>
            }
          </div>

          {/* Receiver */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Receiver address</label>
            <input value={receiver} onChange={e => setReceiver(e.target.value)}
              placeholder="0x…" disabled={loading || !walletAddress} autoComplete="off" spellCheck={false}
              className={inputCls} />
            <p className="text-[11px] text-slate-400 mt-1.5">The receiver must accept before funds can be locked</p>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Amount (USDC)</label>
            <div className="relative">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" disabled={loading || !walletAddress} min="0.01" step="0.01" autoComplete="off"
                className={cn(inputCls, 'pr-20')} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 tracking-wider">USDC</span>
            </div>
          </div>

          {/* How it works steps */}
          <div className="dark:bg-white/[0.02] bg-slate-50 rounded-xl p-4 border dark:border-white/[0.06] border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Flow after creation</p>
            <div className="space-y-2.5">
              {[
                { n:'01', t:'Share',  d:'Copy the pact link and send to your receiver' },
                { n:'02', t:'Accept', d:'Receiver connects wallet and accepts the terms' },
                { n:'03', t:'Fund',   d:'You lock USDC into the escrow' },
                { n:'04', t:'Settle', d:'Both agree to release or refund' },
              ].map(s => (
                <div key={s.n} className="flex items-start gap-3">
                  <span className="text-[10px] font-black font-mono text-blue-400 shrink-0 mt-0.5">{s.n}</span>
                  <div>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{s.t} — </span>
                    <span className="text-xs text-slate-400">{s.d}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" disabled={loading || !isValid}
            className="w-full py-3.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-glow-sm">
            {loading ? <span className="flex items-center justify-center gap-2"><Spinner size="sm" />Creating pact…</span> : 'Create Pact'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Pact Detail
// ─────────────────────────────────────────────────────────────────────────────

function PactDetailPage({ walletAddress, connectWallet, pushToast }: {
  walletAddress: string | null
  connectWallet: () => Promise<string | null>
  pushToast: (msg: string, type?: Toast['type'], dur?: number) => void
}) {
  const { id } = useParams<{ id: string }>()
  const [pact, setPact]       = useState<Pact | null>(null)
  const [role, setRole]       = useState<PactRole>('viewer')
  const [loading, setLoading] = useState(true)
  const [actLoading, setActLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  // Load pact and derive role
  const loadPact = useCallback(async (silent = false) => {
    if (!id) return
    if (!silent) setLoading(true)
    try {
      if (walletAddress) {
        const { role: r, pact: p } = await fetchPactRole(id, walletAddress)
        setPact(p); setRole(r)
      } else {
        const p = await fetchPactById(id)
        setPact(p); setRole('viewer')
      }
    } catch { if (!silent) pushToast('Could not load pact', 'error') }
    finally { if (!silent) setLoading(false) }
  }, [id, walletAddress, pushToast])

  useEffect(() => { loadPact() }, [loadPact])
  // Re-derive role when wallet changes
  useEffect(() => {
    if (!pact) return
    const w = walletAddress?.toLowerCase()
    const r: PactRole = w === pact.senderAddress.toLowerCase() ? 'sender'
      : w === pact.receiverAddress.toLowerCase() ? 'receiver' : 'viewer'
    setRole(r)
  }, [walletAddress, pact])
  // Poll silently
  useEffect(() => { const id2 = setInterval(() => loadPact(true), 4000); return () => clearInterval(id2) }, [loadPact])

  const handleAction = async (pactId: string, action: string) => {
    const caller = walletAddress
    if (!caller) { pushToast('Connect your wallet first', 'error'); return }
    setActLoading(true)
    if (['lock', 'approve-release', 'approve-refund'].includes(action.split(':')[0]))
      pushToast('Sending to Arc network — up to 30s', 'info', 30000)
    try {
      let updated: Pact
      if      (action === 'accept')          { updated = await acceptPact(pactId, caller);     pushToast('Pact accepted', 'success') }
      else if (action === 'cancel')          { updated = await cancelPact(pactId, caller);     pushToast('Pact cancelled', 'success') }
      else if (action === 'lock')            { updated = await lockFunds(pactId, caller, pact!.amount); pushToast('Funds locked in escrow', 'success') }
      else if (action === 'request-release') { updated = await requestRelease(pactId, caller); pushToast('Payment requested', 'info') }
      else if (action === 'approve-release') { updated = await approveRelease(pactId, caller, pact!.amount, pact!.receiverAddress); pushToast('Funds released', 'success') }
      else if (action === 'request-refund')  { updated = await requestRefund(pactId, caller);  pushToast('Refund requested', 'info') }
      else if (action === 'approve-refund')  { updated = await approveRefund(pactId, caller, pact!.amount, pact!.senderAddress);  pushToast('Funds refunded', 'success') }
      else if (action.startsWith('dispute:')) { updated = await raiseDispute(pactId, caller, action.slice(8)); pushToast('Dispute raised', 'info') }
      else return
      setPact(updated)
    } catch (err) { pushToast(getErrorMessage(err), 'error', 7000) }
    finally { setActLoading(false) }
  }

  const copyLink = async () => {
    const link = `${window.location.origin}/pact/${id}`
    await navigator.clipboard.writeText(link).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
    pushToast('Pact link copied — send to your receiver', 'success')
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-20 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400"><Spinner size="lg" /><span>Loading pact…</span></div>
      </div>
    )
  }

  if (!pact) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-20 text-center">
        <p className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Pact not found</p>
        <p className="text-slate-400 mb-6">This pact doesn't exist or was removed.</p>
        <Link to="/" className="px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors">Go Home</Link>
      </div>
    )
  }

  const st = STATUS[pact.status]
  const isTerminal = pact.status === 'COMPLETED' || pact.status === 'REFUNDED'
  const locked = pact.status === 'FUNDS_LOCKED' || pact.status === 'DISPUTED'

  return (
    <div className="max-w-2xl mx-auto px-5 py-10">
      {/* Back */}
      <Link to="/pacts" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-6">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        All Pacts
      </Link>

      {/* Wallet connect prompt if not connected */}
      {!walletAddress && (
        <div className="dark:bg-blue-500/10 bg-blue-50 border dark:border-blue-500/20 border-blue-200 rounded-xl px-5 py-4 mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Connect your wallet</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Connect to see your role and available actions</p>
          </div>
          <button onClick={connectWallet} className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors">
            Connect Wallet
          </button>
        </div>
      )}

      {/* Role banner */}
      {walletAddress && role !== 'viewer' && (
        <div className={cn('rounded-xl px-5 py-3 mb-6 flex items-center gap-3',
          role === 'sender' ? 'dark:bg-blue-500/10 bg-blue-50 dark:border-blue-500/20 border-blue-200 border' : 'dark:bg-emerald-500/10 bg-emerald-50 dark:border-emerald-500/20 border-emerald-200 border')}>
          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0',
            role === 'sender' ? 'bg-blue-600' : 'bg-emerald-500')}>
            {role === 'sender' ? 'S' : 'R'}
          </div>
          <div>
            <p className={cn('text-sm font-semibold', role === 'sender' ? 'text-blue-900 dark:text-blue-200' : 'text-emerald-900 dark:text-emerald-200')}>
              You are the {role}
            </p>
            <p className={cn('text-xs mt-0.5', role === 'sender' ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400')}>
              {role === 'sender' ? 'You sent this escrow request' : 'You were designated as the receiver'}
            </p>
          </div>
        </div>
      )}

      {/* Main pact card */}
      <div className={cn('dark:bg-arc-800 bg-white rounded-2xl border dark:shadow-card shadow-card-light overflow-hidden mb-6',
        isTerminal ? 'dark:border-white/[0.06] border-slate-200' : 'dark:border-white/[0.08] border-slate-200')}>
        <div className={cn('h-1 w-full', st.bar)} />

        <div className="p-7">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-sm text-slate-400 dark:text-slate-500 tracking-wider">#{pact.id.slice(0, 8).toUpperCase()}</span>
                <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full border', 'dark:' + st.badgeDark, st.badge)}>{st.label}</span>
              </div>
              <p className="text-sm text-slate-400">{st.desc}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black tabular-nums text-slate-900 dark:text-white">{parseFloat(pact.amount).toFixed(2)}</div>
              <div className="text-xs font-bold text-slate-400 tracking-widest uppercase mt-0.5">USDC</div>
            </div>
          </div>

          {/* Dispute note */}
          {pact.status === 'DISPUTED' && pact.disputeNote && (
            <div className="bg-orange-500/[0.08] border border-orange-500/20 rounded-xl px-4 py-3 mb-5">
              <p className="text-sm text-orange-300">"{pact.disputeNote}"</p>
              <p className="text-xs text-orange-500/70 mt-0.5">Raised by {pact.disputedBy}</p>
            </div>
          )}

          {/* Pending action banners */}
          {locked && pact.receiverReleaseRequest && !pact.senderApproval && role === 'sender' && (
            <div className="bg-amber-500/[0.08] border border-amber-500/20 rounded-xl px-4 py-3 mb-5 flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse-slow shrink-0" />
              <p className="text-sm font-medium text-amber-300">Receiver requested payment — your approval needed</p>
            </div>
          )}
          {locked && pact.senderRefundRequest && !pact.receiverApproval && role === 'receiver' && (
            <div className="bg-rose-500/[0.08] border border-rose-500/20 rounded-xl px-4 py-3 mb-5 flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-rose-400 animate-pulse-slow shrink-0" />
              <p className="text-sm font-medium text-rose-300">Sender requested a refund — your approval needed</p>
            </div>
          )}

          {/* Lifecycle */}
          <div className="mb-6"><LifecycleTrack status={pact.status} /></div>

          {/* Addresses */}
          <div className="dark:bg-white/[0.03] bg-slate-50 rounded-xl p-4 mb-6 border dark:border-white/[0.06] border-slate-100 space-y-3">
            {[['Sender', pact.senderAddress], ['Receiver', pact.receiverAddress]].map(([lbl, addr]) => (
              <div key={lbl} className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-widest w-16 shrink-0">{lbl}</span>
                <span className="font-mono text-sm text-slate-600 dark:text-slate-300 truncate">{addr.slice(0, 14)}…{addr.slice(-8)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 pt-2 border-t dark:border-white/[0.05] border-slate-100">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-widest w-16 shrink-0">Created</span>
              <span className="text-sm text-slate-500">{new Date(pact.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          {/* Actions */}
          <PactActions pact={pact} role={role} walletAddress={walletAddress} onAction={handleAction} loading={actLoading} />
        </div>
      </div>

      {/* Share section */}
      <div className="dark:bg-arc-800 bg-white rounded-2xl border dark:border-white/[0.08] border-slate-200 dark:shadow-card shadow-card-light p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Share Pact</h3>
            <p className="text-xs text-slate-400 mt-0.5">Anyone with this link can view the pact. Only the correct wallet can act.</p>
          </div>
          <button onClick={copyLink}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl btn-press transition-all',
              copied ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-glow-sm')}>
            {copied
              ? <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>Copied!</>
              : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>Copy Link</>
            }
          </button>
        </div>
        <div className="dark:bg-white/[0.03] bg-slate-50 rounded-xl px-4 py-2.5 border dark:border-white/[0.06] border-slate-100">
          <p className="font-mono text-xs text-slate-400 truncate">{window.location.origin}/pact/{id}</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: All Pacts
// ─────────────────────────────────────────────────────────────────────────────

function PactsPage({ walletAddress, connectWallet, pushToast }: {
  walletAddress: string | null
  connectWallet: () => Promise<string | null>
  pushToast: (msg: string, type?: Toast['type']) => void
}) {
  const [pacts, setPacts]     = useState<Pact[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'all' | 'mine' | 'active' | 'closed'>('all')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try { const data = await fetchAllPacts(); setPacts([...data].reverse()) }
    catch { if (!silent) pushToast('Could not load pacts', 'error') }
    finally { if (!silent) setLoading(false) }
  }, [pushToast])

  useEffect(() => { load() }, [load])
  useEffect(() => { const id = setInterval(() => load(true), 4000); return () => clearInterval(id) }, [load])

  const filtered = pacts.filter(p => {
    const w = walletAddress?.toLowerCase()
    const isMine = w && (p.senderAddress.toLowerCase() === w || p.receiverAddress.toLowerCase() === w)
    const isActive = ['CREATED', 'ACCEPTED', 'FUNDS_LOCKED', 'DISPUTED'].includes(p.status)
    if (filter === 'mine')   return isMine
    if (filter === 'active') return isActive
    if (filter === 'closed') return p.status === 'COMPLETED' || p.status === 'REFUNDED'
    return true
  })

  return (
    <div className="max-w-6xl mx-auto px-5 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Pacts</h1>
          <p className="text-slate-400 mt-1">{pacts.length} total · {pacts.filter(p => ['CREATED','ACCEPTED','FUNDS_LOCKED','DISPUTED'].includes(p.status)).length} active</p>
        </div>
        <Link to="/new" className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors shadow-glow-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          New Pact
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 dark:bg-white/[0.03] bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        {(['all', 'mine', 'active', 'closed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-4 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors',
              filter === f
                ? 'dark:bg-white/10 bg-white dark:text-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white')}>
            {f === 'mine' && !walletAddress ? 'Mine 🔒' : f}
          </button>
        ))}
      </div>

      {!walletAddress && filter === 'mine' && (
        <div className="dark:bg-blue-500/10 bg-blue-50 border dark:border-blue-500/20 border-blue-200 rounded-xl px-5 py-4 mb-6 flex items-center justify-between">
          <p className="text-sm text-blue-600 dark:text-blue-300">Connect your wallet to see your pacts</p>
          <button onClick={connectWallet} className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg btn-press transition-colors">Connect</button>
        </div>
      )}

      {loading
        ? <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        : filtered.length === 0
          ? <div className="dark:bg-arc-800 bg-white rounded-2xl border dark:border-white/[0.07] border-slate-200 p-16 text-center dark:shadow-card shadow-card-light">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 mx-auto mb-4 flex items-center justify-center">
                <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
              </div>
              <p className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">No pacts found</p>
              <p className="text-sm text-slate-400 mb-5">
                {filter === 'mine' ? 'No pacts found for your wallet.' : 'No pacts match this filter.'}
              </p>
              <Link to="/new" className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors shadow-glow-sm">
                Create First Pact
              </Link>
            </div>
          : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(p => <PactCard key={p.id} pact={p} walletAddress={walletAddress} />)}
            </div>
      }
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const { dark, toggle: toggleTheme }                    = useTheme()
  const { address: walletAddress, connect: connectWallet, disconnect } = useWallet()
  const { toasts, push: pushToast }                      = useToasts()
  const [unreadCount, setUnreadCount]                    = useState(0)

  const refreshUnread = useCallback(async () => {
    try {
      const notifs = await fetchNotifications(walletAddress ?? undefined)
      setUnreadCount(notifs.filter(n => !n.read).length)
    } catch { /* silent */ }
  }, [walletAddress])

  useEffect(() => { refreshUnread() }, [refreshUnread])
  useEffect(() => {
    const id = setInterval(refreshUnread, 8000)
    return () => clearInterval(id)
  }, [refreshUnread])

  const sharedProps = { walletAddress, connectWallet, pushToast }

  return (
    <div className="min-h-screen dark:bg-arc-950 bg-slate-50 text-slate-900 dark:text-slate-100">
      <Navbar
        walletAddress={walletAddress}
        connectWallet={connectWallet}
        disconnect={disconnect}
        dark={dark}
        toggleTheme={toggleTheme}
        unreadCount={unreadCount}
        refreshUnread={refreshUnread}
      />

      <main>
        <Routes>
          <Route path="/"           element={<HomePage     {...sharedProps} />} />
          <Route path="/pacts"      element={<PactsPage    {...sharedProps} />} />
          <Route path="/new"        element={<NewPactPage  {...sharedProps} />} />
          <Route path="/pact/:id"   element={<PactDetailPage {...sharedProps} />} />
          {/* Catch-all */}
          <Route path="*" element={
            <div className="max-w-2xl mx-auto px-5 py-20 text-center">
              <p className="text-5xl font-black text-slate-900 dark:text-white mb-3">404</p>
              <p className="text-slate-400 mb-6">Page not found</p>
              <Link to="/" className="px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl btn-press transition-colors">Go Home</Link>
            </div>
          } />
        </Routes>
      </main>

      <ToastStack toasts={toasts} />
    </div>
  )
}
