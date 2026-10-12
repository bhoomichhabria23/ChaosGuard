import { useEffect, useState } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check,
  CheckCircle2, ChevronDown, Clock3, Cloud, Cpu,
  Download, Eye, EyeOff, FileText, FlaskConical, Gauge, History,
  Building2, CalendarDays, IdCard, LayoutDashboard,
  LockKeyhole, LogOut, Menu, MoreHorizontal, Play, Plus, Search,
  Pencil, Server, Settings, Shield, ShieldCheck, Trash2, UserRound, Users, X, Zap,
} from 'lucide-react'
import './theme.css'
import './console.css'

const experiments = [
  { id: 'pod', name: 'Pod Failure', category: 'KUBERNETES', description: 'Terminate a selected pod and evaluate Kubernetes self-healing and service recovery.', icon: Server, color: 'blue', detail: 'Safely evicts one pod from the selected deployment. Kubernetes schedules a replacement while ChaosGuard tracks service health and recovery time.' },
  { id: 'cpu', name: 'CPU Stress', category: 'RESOURCE PRESSURE', description: 'Generate controlled CPU pressure and observe application performance under resource stress.', icon: Cpu, color: 'violet', detail: 'Applies a bounded CPU load to selected pods. Resource limits and health checks remain in effect throughout the experiment.' },
  { id: 'memory', name: 'Memory Stress', category: 'RESOURCE PRESSURE', description: 'Allocate controlled memory pressure and measure the workload response.', icon: Cpu, color: 'cyan', detail: 'Allocates a bounded amount of memory in the selected service and records the real memory response from the workload.' },
]

const navItems = [
  { label: 'Overview', page: 'dashboard', icon: LayoutDashboard },
  { label: 'Microservices', page: 'services', icon: Cloud },
  { label: 'Chaos experiments', page: 'experiments', icon: FlaskConical },
  { label: 'Live monitoring', page: 'live', icon: Activity },
  { label: 'Metrics', page: 'reports', icon: Gauge },
  { label: 'Reports', page: 'reports', icon: FileText },
  { label: 'Experiment history', page: 'history', icon: History },
]

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark"><Shield size={21} strokeWidth={1.8} /><Zap className="brand-bolt" size={11} fill="currentColor" /></span><span className="brand-name">CHAOS<span>GUARD</span></span></div>
}

function NetworkVisual() {
  const nodes = [
    { name: 'USER SERVICE', className: 'node-user', icon: Users },
    { name: 'ORDER SERVICE', className: 'node-order', icon: Server },
    { name: 'PAYMENT SERVICE', className: 'node-payment', icon: LockKeyhole },
    { name: 'NOTIFICATION SERVICE', className: 'node-events', icon: Bell },
  ]
  return <div className="network-visual" aria-label="Live infrastructure recovery visualization"><div className="visual-topline"><span><span className="live-dot" /> KUBERNETES TOPOLOGY</span><span>prod-us-east-1 <ChevronDown size={12} /></span></div><div className="network-stage"><svg className="network-lines" viewBox="0 0 600 340" preserveAspectRatio="none" aria-hidden="true"><path d="M78 150 L222 150 M222 150 L366 150 M366 150 L510 150" /><path className="flow-line" d="M78 150 L222 150 M222 150 L366 150 M366 150 L510 150" /></svg>{nodes.map(({ name, className, icon: Icon }, index) => <div className={`service-node ${className}`} key={name} style={{ animationDelay: `${index * 100}ms` }}><div className="node-icon"><Icon size={17} /></div><span>{name}</span><i /></div>)}<div className="flow-pulse pulse-one" /><div className="flow-pulse pulse-two" /></div><div className="recovery-sequence"><span className="recovery-step recovery-fault"><LockKeyhole size={13} /> Payment Service</span><span className="recovery-arrow">→</span><span className="recovery-step recovery-warning"><Zap size={13} /> CPU stress injected</span><span className="recovery-arrow">→</span><span className="recovery-step recovery-recovery"><Server size={13} /> Kubernetes recovery</span><span className="recovery-arrow">→</span><span className="recovery-step recovery-success"><CheckCircle2 size={13} /> Service recovered</span></div><div className="visual-footer"><span><i className="legend-healthy" /> 4 SERVICES</span><span><i className="legend-link" /> LIVE DATA FLOW</span><span className="visual-refresh"><Activity size={12} /> STREAMING</span></div></div>
}

function Landing({ onNavigate }) {
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  return <div className="landing min-h-screen"><header className="landing-header flex items-center justify-between"><Brand /><nav><a href="#platform">Platform</a><a href="#capabilities">Capabilities</a><a href="#security">Security</a><a href="#monitoring">Monitoring</a><a href="#reports">Reports</a></nav><div className="landing-actions flex items-center"><button className="button-quiet" onClick={() => onNavigate('login')}>Sign in</button><button className="button-primary button-small" onClick={() => onNavigate('dashboard')}>Launch dashboard <ArrowRight size={15} /></button></div></header><main><section className="landing-hero grid items-center" id="platform"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-mark"><ShieldCheck size={13} /></span> KUBERNETES ENVIRONMENT OPERATIONAL</div><h1>CONTROLLED FAILURE.<br /><span>CONFIDENT SYSTEMS.</span></h1><p>ChaosGuard helps engineering teams test microservice resilience by injecting controlled failures, observing system behavior, and measuring how quickly applications detect and recover from disruption.</p><div className="hero-buttons"><button className="button-primary" onClick={() => onNavigate('dashboard')}>Launch dashboard <ArrowRight size={16} /></button><button className="button-secondary" onClick={() => scrollTo('capabilities')}>Explore capabilities <ChevronDown size={15} /></button></div><div className="hero-proof hero-points"><span><Check size={14} /> Kubernetes-native testing</span><span><Check size={14} /> Controlled fault injection</span><span><Check size={14} /> Real-time resilience monitoring</span></div></div><NetworkVisual /></section><section className="landing-metrics grid grid-cols-2 md:grid-cols-4" aria-label="Demo platform metrics"><div><strong>4</strong><span>MICROSERVICES TESTED</span></div><div><strong>12</strong><span>CHAOS EXPERIMENTS</span></div><div><strong>99.95%</strong><span>SYSTEM AVAILABILITY</span></div><div><strong>1.8m</strong><span>AVERAGE RECOVERY TIME</span></div></section><section className="landing-introduction" id="monitoring"><div className="section-kicker">THE CHAOSGUARD PLATFORM</div><h2>ENGINEER FOR FAILURE.<br /><span>DESIGN FOR RESILIENCE.</span></h2><p>ChaosGuard provides a controlled environment for testing how microservices behave under failure conditions. Inject disruption, observe system behavior, and understand recovery performance before real incidents expose weaknesses.</p><div className="platform-flow"><span>Microservices</span><ArrowRight size={18} /><span>Chaos experiments</span><ArrowRight size={18} /><span>Monitoring</span><ArrowRight size={18} /><span>Resilience analysis</span></div></section><section className="landing-capabilities" id="capabilities"><div className="capabilities-heading"><div><div className="section-kicker">CHAOS EXPERIMENTS</div><h2>Test how your services<br /><span>respond under pressure.</span></h2></div><p>Choose a bounded experiment, define the target, and turn recovery behavior into engineering evidence.</p></div><div className="capability-grid grid md:grid-cols-3"><article><span className="cap-icon icon-blue"><Server size={18} /></span><h3>Pod failure</h3><p>Terminate a selected pod and observe Kubernetes recovery behavior.</p><div className="capability-meta"><span>CONTROLLED FAILURE</span><b>01</b></div></article><article><span className="cap-icon icon-violet"><Cpu size={18} /></span><h3>CPU stress</h3><p>Apply controlled resource pressure and measure its impact on service performance.</p><div className="capability-meta"><span>RESOURCE TEST</span><b>02</b></div></article>  <article><span className="cap-icon icon-cyan"><Cpu size={18} /></span><h3>Memory stress</h3><p>Apply controlled memory pressure and measure its impact on service performance.</p><div className="capability-meta"><span>RESOURCE TEST</span><b>03</b></div></article></div><div className="capabilities-note"><ShieldCheck size={17} /><span>Every experiment is scoped with guardrails, observable signals, and automatic rollback protection.</span></div></section><section className="landing-workflow" id="reports"><div className="section-kicker">THE OPERATING MODEL</div><h2>FROM FAILURE TO RESILIENCE</h2><div className="workflow-grid"><article><b>01 INJECT</b><span>Introduce a controlled failure.</span></article><article><b>02 OBSERVE</b><span>Monitor service and infrastructure behavior.</span></article><article><b>03 RECOVER</b><span>Track Kubernetes and application recovery.</span></article><article><b>04 MEASURE</b><span>Analyze recovery time, availability, errors, and resilience.</span></article></div></section><section className="landing-security" id="security"><div className="section-kicker">SECURITY BY DESIGN</div><h2>Build systems that recover<br /><span>under pressure.</span></h2><p>Test resilience before failure becomes an incident.</p><div className="security-grid"><article><ShieldCheck size={22} /><h3>Guardrails first</h3><span>Bounded intensity, explicit targets, and automatic rollback.</span></article><article><LockKeyhole size={22} /><h3>Private by default</h3><span>Authenticated workspaces keep experiment access controlled.</span></article><article><Activity size={22} /><h3>Evidence you can trust</h3><span>Live signals and recovery history make every result actionable.</span></article></div><button className="button-primary" onClick={() => onNavigate('login')}>Launch ChaosGuard <ArrowRight size={16} /></button></section></main><footer className="landing-footer flex items-center justify-between"><Brand compact /><span>Cloud-native resilience testing for modern microservices.</span><span>© 2026 ChaosGuard. All rights reserved.</span></footer></div>
}

function Login({ onLogin, onBack }) {
  const [remember, setRemember] = useState(true)
  return <div className="login-page"><div className="login-left"><button className="login-back" onClick={onBack}><ArrowLeft size={15} /> Back to home</button><div className="login-message"><span className="eyebrow"><ShieldCheck size={13} /> CHAOSGUARD PLATFORM</span><h1>Resilience starts<br />with <span>controlled failure.</span></h1><p>Know how your systems respond before your customers do.</p><div className="login-decoration"><NetworkVisual /></div></div><div className="login-foot">© 2025 ChaosGuard · Cloud resilience, engineered.</div></div><div className="login-right"><div className="login-card"><div className="login-card-mark"><ShieldCheck size={18} /></div><div className="section-kicker">WELCOME BACK</div><h2>Sign in to your workspace</h2><p className="login-subtitle">Use your work credentials to continue.</p><form onSubmit={(event) => { event.preventDefault(); onLogin() }}><label>Email address<input type="email" placeholder="you@company.com" defaultValue="alex@acme.cloud" required /></label><label>Password<div className="password-wrap"><input type="password" placeholder="Enter your password" defaultValue="resilience-demo" required /><LockKeyhole size={15} /></div></label><div className="form-extras"><label className="check-label"><input type="checkbox" checked={remember} onChange={() => setRemember(!remember)} /> Remember me</label><button type="button" className="text-link">Forgot password?</button></div><button className="button-primary login-submit" type="submit">Sign in <ArrowRight size={15} /></button></form><div className="login-divider"><span />SECURE ACCESS<span /></div><div className="login-secure"><LockKeyhole size={13} /> Protected with end-to-end encryption</div></div><div className="login-mobile-brand"><Brand compact /></div></div></div>
}

function AuthPage({ onAuthenticated, onBack, onToast }) {
  void Login
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password }),
      })
      const responseText = await response.text()
      let body = {}
      if (responseText) {
        try {
          body = JSON.parse(responseText)
        } catch {
          throw new Error(response.status >= 500
            ? 'Authentication service is unavailable. Start the API with npm run dev.'
            : `Authentication service returned an invalid response (${response.status})`)
        }
      }
      if (!response.ok) throw new Error(body.error || 'Unable to authenticate')
      if (!body.user) throw new Error('Authentication service did not return a user')
      if (isLogin) {
        onAuthenticated(body.user)
      } else {
        onToast('Account registered successfully. Please sign in.')
        setMode('login')
        setPassword('')
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to authenticate')
    } finally {
      setSubmitting(false)
    }
  }

  const isLogin = mode === 'login'
  return <div className="login-page"><div className="login-left"><button className="login-back" onClick={onBack}><ArrowLeft size={15} /> Back to home</button><div className="login-message"><span className="eyebrow"><ShieldCheck size={13} /> CHAOSGUARD PLATFORM</span><h1>Resilience starts<br />with <span>controlled failure.</span></h1><p>Know how your systems respond before your customers do.</p><div className="login-decoration"><NetworkVisual /></div></div><div className="login-foot">Cloud resilience, engineered.</div></div><div className="login-right"><div className="login-card"><div className="login-card-mark"><ShieldCheck size={18} /></div><div className="section-kicker">{isLogin ? 'WELCOME BACK' : 'GET STARTED'}</div><h2>{isLogin ? 'Sign in to your workspace' : 'Create your workspace account'}</h2><p className="login-subtitle">{isLogin ? 'Use your registered credentials to continue.' : 'Register to start running guarded experiments.'}</p><form onSubmit={submit}>{!isLogin && <label>Full name<input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>}<label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" required /></label><label>Password<div className="password-wrap"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'} minLength={8} required /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>{error && <p role="alert" className="form-error">{error}</p>}<button className="button-primary login-submit" type="submit" disabled={submitting}>{submitting ? 'Signing in...' : isLogin ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></button></form><div className="login-divider"><span />SECURE ACCESS<span /></div><div className="login-secure"><LockKeyhole size={13} /> Protected with end-to-end encryption</div><button className="text-link auth-switch" onClick={() => { setMode(isLogin ? 'register' : 'login'); setError('') }}>{isLogin ? 'Need an account? Sign up' : 'Already registered? Sign in'}</button></div><div className="login-mobile-brand"><Brand compact /></div></div></div>
}

function AppShell({ page, onNavigate, children, onToast, user }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const title = page === 'dashboard' ? 'Dashboard' : page === 'services' ? 'Microservices' : page === 'experiments' || page === 'configure' ? 'Chaos experiments' : page === 'live' ? 'Live monitoring' : page === 'result' ? 'Experiment report' : page === 'reports' ? 'Reports & analytics' : page === 'history' ? 'Experiment history' : 'Settings'
  const topLinks = { Dashboard: 'dashboard', Services: 'services', Experiments: 'experiments', Monitoring: 'live', Reports: 'reports', History: 'history' }
  const initials = user?.name?.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U'
  return <div className="app-shell"><header className="topbar"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={18} /></button><button className="topbar-brand" onClick={() => onNavigate('dashboard')}><Brand compact /></button><nav className="top-nav">{Object.entries(topLinks).map(([label, target]) => <button className={page === target || (page === 'configure' && target === 'experiments') || (page === 'result' && target === 'history') ? 'top-nav-active' : ''} key={label} onClick={() => onNavigate(target)}>{label}</button>)}</nav><div className="topbar-right"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => onToast("You're all caught up")}><Bell size={17} /><i /></button><span className="topbar-divider" /><button className="profile-button" title="Account settings" onClick={() => onNavigate('settings')}><span>{initials}</span><ChevronDown size={12} /></button></div></header><aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}><div className="workspace-picker"><span className="workspace-avatar">{initials[0]}</span><span><b>{user?.name || 'Workspace'}</b><small>{user?.email || 'Authenticated user'}</small></span><ChevronDown size={13} /></div><div className="side-label">WORKSPACE</div><nav className="side-nav">{navItems.map(({ label, page: itemPage, icon: Icon }) => <button key={label} onClick={() => { onNavigate(itemPage); setSidebarOpen(false) }} className={`${page === itemPage || (page === 'configure' && itemPage === 'experiments') || (page === 'result' && itemPage === 'history') ? 'side-active' : ''}`}><Icon size={16} /><span>{label}</span>{label === 'Live monitoring' && page === 'live' && <i className="nav-live-dot" />}</button>)}</nav><div className="side-label side-label-lower">PREFERENCES</div><button className={`side-link ${page === 'settings' ? 'side-active' : ''}`} onClick={() => onNavigate('settings')}><Settings size={16} /><span>Settings</span></button><div className="sidebar-bottom"><div className="sidebar-user"><div className="user-avatar">{initials}</div><div><b>{user?.name}</b><span>{user?.email}</span></div><button title="Sign out" onClick={() => onNavigate('login')}><LogOut size={15} /></button></div></div></aside><main className="main-content"><div className="mobile-page-title"><span>{title}</span><span className="breadcrumb-dot">/</span> {user?.name || 'Workspace'}</div>{children}</main><button className={`sidebar-overlay ${sidebarOpen ? 'overlay-visible' : ''}`} aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /></div>
}

function PageHeader({ eyebrow, title, description, action }) {
  return <div className="page-header"><div><div className="section-kicker">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-header-action">{action}</div>}</div>
}

function MetricCard({ icon: Icon, label, value, note, color, trend, showMore = true }) {
  return <div className={`metric-card metric-${color}`}><div className="metric-top"><span className="metric-icon"><Icon size={16} /></span>{trend && <span className={`metric-trend ${trend.startsWith('-') ? 'trend-down' : ''}`}><ArrowUpRight size={12} />{trend}</span>}{showMore && <button className="metric-more" aria-label={`More about ${label}`}><MoreHorizontal size={16} /></button>}</div><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span><div className="metric-decoration" /></div>
}

const API_BASE = ''
const serviceNames = ['user-service', 'order-service', 'payment-service', 'notification-service']
const N_A = 'N/A'

async function apiRequest(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: options.credentials ?? 'include',
    })
  } catch {
    throw new Error('Backend unavailable. Start the Node.js backend on port 4174.')
  }
  let data = null
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const requestError = new Error(data?.error || data?.message || 'The backend could not complete the request.')
    requestError.responseData = data
    requestError.status = response.status
    throw requestError
  }
  if (!data) throw new Error('The backend returned an empty response.')
  return data
}

function experimentLabel(type) {
  return type === 'pod-failure' ? 'Pod Failure' : type === 'cpu-stress' ? 'CPU Stress' : type === 'memory-stress' ? 'Memory Stress' : type || N_A
}

function formatValue(value, suffix = '') {
  return value === null || value === undefined || value === '' ? N_A : `${value}${suffix}`
}

const scoreMetricDetails = [
  { key: 'recovery', label: 'Recovery time', measurement: 'recoveryTimeMs', unit: ' ms', icon: Clock3 },
  { key: 'detection', label: 'Detection time', measurement: 'detectionTimeMs', unit: ' ms', icon: Activity },
  { key: 'availability', label: 'Availability', measurement: 'availabilityPercent', unit: ' %', icon: Gauge },
  { key: 'stability', label: 'Pod stability', measurement: 'restartCountDelta', unit: ' restarts', icon: ShieldCheck },
]

function ResilienceScorePanel({ experiment }) {
  if (!experiment) return null
  const measurements = experiment.scoreMeasurements || {}
  const breakdown = experiment.scoreBreakdown || {}
  const overallScore = experiment.resilienceScore
  const hasOverallScore = Number.isFinite(overallScore) && overallScore >= 0 && overallScore <= 100
  const scorePieCircumference = 2 * Math.PI * 40
  const scorePieOffset = scorePieCircumference * (1 - (hasOverallScore ? overallScore : 0) / 100)
  const isPodFailure = experiment.type === 'pod-failure'
  const restartMeasurement = measurements.restartCountDelta === null || measurements.restartCountDelta === undefined
    ? formatValue(measurements.podRestartCount, ' replacement pod restarts')
    : formatValue(measurements.restartCountDelta, ' restarts')
  const stabilityEvidence = measurements.podStabilityMeasurement
  const visibleMissingMetrics = experiment.missingMetrics || []
  const stabilityMeasurement = isPodFailure && stabilityEvidence?.status === 'measured'
    ? `${restartMeasurement} · ${formatValue(stabilityEvidence.disruptionCount, ' pod disruptions')}`
    : restartMeasurement

  return <section className="panel score-breakdown-panel">
    <div className="score-panel-topline">
      <span className="score-panel-eyebrow"><ShieldCheck size={13} /> RESILIENCE ANALYSIS</span>
      <span className={`score-status-pill score-status-${String(experiment.status || 'unknown').toLowerCase()}`}>
        <i />{experiment.status || N_A}
      </span>
    </div>
    <div className="score-panel-heading">
      <div className="score-panel-copy">
        <h2>Resilience score</h2>
        <p className="score-experiment-meta">
          <span><Server size={12} /> {experiment.target || N_A}</span>
          <span className="score-meta-divider" />
          <span>{experimentLabel(experiment.type)}</span>
          <span className="score-meta-divider" />
          <time>{experiment.completedAt || experiment.startedAt || N_A}</time>
        </p>
        {experiment.scoreUnavailableReason && <p className="score-unavailable-reason">{experiment.scoreUnavailableReason}</p>}
      </div>
      <div className="score-pie-summary" aria-label={hasOverallScore ? `Resilience score ${overallScore} out of 100` : 'Resilience score unavailable'}>
        <svg viewBox="0 0 92 92" aria-hidden="true">
          <circle className="score-pie-track" cx="46" cy="46" r="40" />
          {hasOverallScore && <circle className="score-pie-value" cx="46" cy="46" r="40" strokeDasharray={scorePieCircumference} strokeDashoffset={scorePieOffset} />}
        </svg>
        <div className="score-pie-label">
          <strong>{hasOverallScore ? `${overallScore}%` : N_A}</strong>
        </div>
        <span className="score-pie-caption">RESILIENCE</span>
      </div>
    </div>
    <div className="score-metric-grid">
      {scoreMetricDetails.map(({ key, label, measurement, unit, icon: Icon }, index) => {
        const value = key === 'stability'
          ? stabilityMeasurement
          : formatValue(measurements[measurement], unit)
        const score = breakdown[key]
        const configuredWeight = experiment.scoreWeights?.[key]
        const effectiveWeight = experiment.effectiveScoreWeights?.[key]
        const hasScore = Number.isFinite(score) && score >= 0 && score <= 100
        const measurementStatus =
          measurements.metricMeasurementStatus?.[key] ||
          (hasScore ? 'measured' : 'unavailable')
        return <div className="score-metric" key={key} style={{ '--metric-order': index }}>
          <div className="score-metric-head">
            <span className={`score-metric-icon score-metric-icon-${key}`}><Icon size={16} /></span>
            <b>{label}</b>
            <span className="score-metric-weight">{formatValue(configuredWeight, '%')} weight</span>
          </div>
          <div className="score-metric-result">
            <strong>{hasScore ? `${score}%` : N_A}</strong>
            {effectiveWeight !== undefined && <span>{effectiveWeight}% effective</span>}
            {effectiveWeight === undefined && <span className="score-metric-excluded">Not scored</span>}
          </div>
          <div className="score-metric-progress" aria-hidden="true">
            <span style={{ width: hasScore ? `${score}%` : '0%' }} />
          </div>
          <small><span>{String(measurementStatus).replaceAll('-', ' ').toUpperCase()}</span>{value}</small>
        </div>
      })}
    </div>
    {visibleMissingMetrics.length > 0 && <div className="score-missing">
      <b>Unavailable metrics</b>
      <ul>{visibleMissingMetrics.map((metric) => <li key={metric}>
        <span>{scoreMetricDetails.find((item) => item.key === metric)?.label || metric}:</span> {experiment.missingMetricReasons?.[metric] || 'No valid measurement was recorded.'}
      </li>)}</ul>
    </div>}
  </section>
}

function Overview({ onNavigate, history }) {
  const completed = history.filter((item) => item.status === 'completed')
  return <><PageHeader eyebrow="LIVE BACKEND DATA" title="Dashboard" description="Monitor actual experiment results returned by Kubernetes and Prometheus." action={<div className="system-status"><i /> BACKEND CONNECTED <ChevronDown size={13} /></div>} /><div className="metrics-grid overview-metrics-grid"><MetricCard icon={Server} label="Services" value={serviceNames.length} note="Configured targets" color="blue" showMore={false} /><MetricCard icon={FlaskConical} label="Completed experiments" value={completed.length} note="Backend history" color="violet" showMore={false} /><MetricCard icon={Activity} label="Latest status" value={history[0]?.status || N_A} note="Most recent result" color="cyan" showMore={false} /><MetricCard icon={Clock3} label="Latest duration" value={formatValue(history[0]?.totalExperimentTimeMs, ' ms')} note="Backend measurement" color="amber" showMore={false} /></div><div className="overview-grid"><section className="panel health-panel"><div className="panel-heading"><div><h2>Experiment health</h2><p>Only values returned by the backend are shown.</p></div></div><div className="health-summary"><div><span>Experiments recorded</span><b>{history.length}</b></div><div><span>Successful</span><b>{completed.length}</b></div><div><span>Latest target</span><b>{history[0]?.target || N_A}</b></div><span className="health-period"><i /> LIVE API</span></div></section><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Backend experiment history</p></div></div><div className="activity-list">{history.slice(0, 4).map((item) => <div className="activity-item" key={item.id}><span className="activity-icon activity-info"><FlaskConical size={14} /></span><div><b>{experimentLabel(item.type)}</b><p>{item.target} · {item.status}</p><time>{item.completedAt || item.startedAt || N_A}</time></div></div>)}</div><button className="panel-footer-link" onClick={() => onNavigate('history')}>View all activity <ArrowRight size={13} /></button></section></div><ResilienceScorePanel experiment={history[0]} /><div className="quick-actions"><div><span className="quick-icon"><Zap size={16} /></span><div><b>Run a real experiment</b><span>Results are measured by Kubernetes and Prometheus.</span></div></div><button className="button-secondary" onClick={() => onNavigate('experiments')}>New experiment <Plus size={15} /></button></div></>
}

function ServicesPage({ onNavigate }) {
  const [serviceMetrics, setServiceMetrics] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    apiRequest('/api/services').then((data) => setServiceMetrics(Array.isArray(data.services) ? data.services : [])).catch((requestError) => setError(requestError.message))
  }, [])
  return <><PageHeader eyebrow="KUBERNETES TARGETS" title="Microservices" description="Select a real Kubernetes service as an experiment target." /><div className="service-cards-grid">{serviceNames.map((name) => { const service = serviceMetrics.find((item) => item.target === name); const cpuValue = service?.cpuUsage === null || service?.cpuUsage === undefined ? N_A : `${(service.cpuUsage * 100).toFixed(2)} %`; return <article className="panel service-detail-card" key={name}><div className="service-detail-head"><span className="service-avatar service-blue"><Server size={17} /></span></div><h2>{name}</h2><div className="service-code"><span>Backend target</span><span className={`service-status ${service?.podName ? '' : 'service-status-unavailable'}`}><i />{service?.podName ? 'Available for experiments' : 'Pod unavailable'}</span></div><div className="service-stat-grid"><div><span>CPU usage</span><b>{cpuValue}</b></div><div><span>Memory</span><b>{formatValue(service?.memoryMb, ' MB')}</b></div><div><span>Pod status</span><b>{formatValue(service?.podStatus)}</b></div><div><span>Restarts</span><b>{formatValue(service?.restartCount)}</b></div></div><div className="service-card-footer"><span><Server size={13} />{error || `Pod readiness: ${service?.ready === true ? 'Ready' : service?.ready === false ? 'Not ready' : N_A}`}</span>{service?.podName && <button onClick={() => onNavigate('experiments')}>Run experiment <ArrowRight size={13} /></button>}</div></article> })}</div></>
}

function ExperimentsPage({ onConfigure, onNavigate, history }) {
  return <><PageHeader eyebrow="SAFE BY DESIGN · GUARDED EXECUTION" title="Chaos experiments" description="Run real Kubernetes experiments and inspect actual Prometheus measurements." action={<button className="button-primary" onClick={() => onConfigure(experiments[0])}><Plus size={15} /> New experiment</button>} /><div className="experiment-intro"><div className="experiment-intro-icon"><ShieldCheck size={18} /></div><div><b>Experiments run against the real backend</b><span>No simulated metrics are displayed.</span></div><button onClick={() => onNavigate('history')}>View history <ArrowRight size={13} /></button></div><div className="experiment-cards">{experiments.map(({ icon: Icon, ...experiment }, index) => <article className={`panel experiment-card exp-${experiment.color}`} key={experiment.id}><div className="experiment-card-top"><span className="experiment-icon"><Icon size={20} /></span><span className="experiment-number">0{index + 1}</span></div><div className="section-kicker">{experiment.category}</div><h2>{experiment.name}</h2><p>{experiment.description}</p><div className="experiment-meta"><span><ShieldCheck size={13} /> Guardrails included</span><span><Clock3 size={13} /> Backend measured</span></div><button className="button-secondary" onClick={() => onConfigure(experiment)}>Configure experiment <ArrowRight size={14} /></button></article>)}</div><section className="panel recent-experiment-panel"><div className="panel-heading"><div><h2>Recent experiments</h2><p>Actual results from the backend</p></div><button className="text-action" onClick={() => onNavigate('history')}>View history <ArrowRight size={13} /></button></div>{history.slice(0, 3).map((row) => <div className="recent-exp-row" key={row.id}><span className="recent-exp-icon"><FlaskConical size={14} /></span><div><b>{experimentLabel(row.type)}</b><span>{row.target} · {row.startedAt || N_A}</span></div><span className="status-tag"><i />{row.status}</span><span className="recent-score">{row.resilienceScore === null || row.resilienceScore === undefined ? N_A : `${row.resilienceScore}%`}</span></div>)}</section></>
}

function ConfigurationPage({ experiment, onBack, onRun }) {
  const isMemory = experiment.id === 'memory'
  const [target, setTarget] = useState('user-service')
  const [durationMs, setDurationMs] = useState(15000)
  const [memoryMb, setMemoryMb] = useState(256)
  const [enableHttpTrafficProbe, setEnableHttpTrafficProbe] = useState(true)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')
  const validate = () => { if (!Number.isInteger(Number(durationMs)) || durationMs < 5000 || durationMs > 30000) return 'Duration must be between 5000 and 30000 ms.'; if (isMemory && (!Number.isInteger(Number(memoryMb)) || memoryMb < 64 || memoryMb > 512)) return 'Memory must be between 64 and 512 MB.'; setError(''); setReviewing(true) }
  const Icon = experiment.icon || Server
  return <><div className="back-link-row"><button className="back-link" onClick={onBack}><ArrowLeft size={14} /> Chaos experiments</button><span>/</span><span>Configure</span></div><PageHeader eyebrow="EXPERIMENT CONFIGURATION" title="Configure chaos experiment" description="Set parameters for a real backend experiment." /><div className="config-layout"><section className="panel config-form-panel"><div className="config-type-banner"><span className={`experiment-icon exp-icon-${experiment.color}`}><Icon size={19} /></span><div><span className="section-kicker">SELECTED EXPERIMENT</span><b>{experiment.name}</b></div><button className="text-action" onClick={onBack}>Change type</button></div><div className="form-field"><label htmlFor="target-service">Target service</label><div className="select-wrap"><select id="target-service" value={target} onChange={(event) => setTarget(event.target.value)}>{serviceNames.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></div></div><div className="form-field"><label htmlFor="experiment-type">Experiment type</label><div className="select-wrap"><select id="experiment-type" value={experiment.id} onChange={(event) => onRun({ changeType: event.target.value })}>{experiments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div></div><div className="form-two-col"><div className="form-field"><label htmlFor="duration-ms">Stress duration (ms)</label><input id="duration-ms" type="number" min="5000" max="30000" step="1000" value={durationMs} onChange={(event) => setDurationMs(Number(event.target.value))} /></div>{isMemory && <div className="form-field"><label htmlFor="memory-mb">Memory amount (MB)</label><input id="memory-mb" type="number" min="64" max="512" value={memoryMb} onChange={(event) => setMemoryMb(Number(event.target.value))} /></div>}</div><label className="http-traffic-probe-option"><input type="checkbox" checked={enableHttpTrafficProbe} onChange={(event) => setEnableHttpTrafficProbe(event.target.checked)} /><span><b>Generate measured traffic</b><small>Opt in to up to 1 real HTTP request/second to this service during the experiment.</small></span></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="config-footer"><span><LockKeyhole size={13} /> Sent to the Node.js backend</span><button className="button-primary" onClick={validate}>Review experiment <ArrowRight size={15} /></button></div></section><aside className="config-aside"><div className="panel impact-panel"><div className="impact-heading"><span className="impact-icon"><Activity size={16} /></span><div><h3>Backend request</h3><span>Real Kubernetes execution</span></div></div><p>{experiment.detail}</p><div className="impact-list"><div><span>Target</span><b>{target}</b></div><div><span>Experiment</span><b>{experiment.name}</b></div><div><span>Duration</span><b>{durationMs} ms</b></div>{isMemory && <div><span>Memory</span><b>{memoryMb} MB</b></div>}</div></div></aside></div>{reviewing && <div className="modal-backdrop" onClick={() => setReviewing(false)}><div className="review-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => setReviewing(false)} aria-label="Close"><X size={17} /></button><span className="modal-mark"><ShieldCheck size={21} /></span><div className="section-kicker">FINAL SAFETY CHECK</div><h2>Run this experiment?</h2><p>The backend will execute {experiment.name} against <b>{target}</b>{enableHttpTrafficProbe && <> while sending up to one real request per second for measurement</>}.</p><div className="review-actions"><button className="button-secondary" onClick={() => setReviewing(false)}>Go back</button><button className="button-primary" onClick={() => onRun({ target, durationMs, memoryMb, enableHttpTrafficProbe })}><Play size={14} fill="currentColor" /> Run experiment</button></div></div></div>}</>
}

function MonitoringPage({ experiment, status, error }) {
  return <><PageHeader eyebrow="PRODUCTION · PROD-US-EAST-1" title={<span className="live-title">Experiment {status}<span className="live-pill"><i /> {status}</span></span>} description={error || 'Waiting for the backend to finish the real Kubernetes experiment.'} /><div className="run-summary panel"><div className="run-target"><span className="service-avatar service-violet"><LockKeyhole size={16} /></span><div><span>TARGET SERVICE</span><b>{experiment.target}</b><small><i className="green-dot" /> Backend execution</small></div></div><div className="run-divider" /><div><span>EXPERIMENT</span><b>{experiment.name}</b><small>Real API request</small></div><div><span>STATUS</span><b className="elapsed-time">{status}</b><small>Metrics appear after completion</small></div><div className="run-progress"><div className="progress-label"><span>Backend progress</span><b>{status === 'Running' ? '...' : status}</b></div><div className="progress-track"><i /></div></div></div><section className="panel impact-panel"><div className="impact-heading"><span className="impact-icon"><Activity size={16} /></span><div><h3>Live result state</h3><span>No fabricated metrics</span></div></div><p>{status === 'Running' ? 'The backend is executing the experiment and querying Prometheus.' : error || 'The backend reported a failure.'}</p></section></>
}

function LifecycleEventChart({ events }) {
  const [hoveredEventIndex, setHoveredEventIndex] = useState(null)
  const width = 760
  const left = 62
  const right = 698
  const top = 24
  const rowHeight = 42
  const plotBottom = top + Math.max(events.length - 1, 0) * rowHeight
  const axisY = plotBottom + 14
  const height = axisY + 30
  const timestamps = events.map((event) => event.timestamp)
  const firstTimestamp = Math.min(...timestamps)
  const lastTimestamp = Math.max(...timestamps)
  const padding = Math.max((lastTimestamp - firstTimestamp) * 0.08, 500)
  const domainStart = firstTimestamp - padding
  const domainEnd = lastTimestamp + padding
  const xFor = (timestamp) => left + ((timestamp - domainStart) / (domainEnd - domainStart)) * (right - left)
  const timeLabel = (timestamp) => new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })

  return <svg
    className="report-lifecycle-chart"
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label={`Timeline chart with ${events.length} recorded experiment events`}
    onMouseLeave={() => setHoveredEventIndex(null)}
  >
    {[0, 1, 2, 3, 4].map((tick) => {
      const x = left + (tick / 4) * (right - left)
      const timestamp = domainStart + (tick / 4) * (domainEnd - domainStart)
      const textAnchor = tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle'
      return <g key={tick}>
        <line x1={x} y1={top - 8} x2={x} y2={plotBottom + 6} className="report-lifecycle-grid" />
        <text x={x} y={axisY + 18} textAnchor={textAnchor} className="report-lifecycle-time">{timeLabel(timestamp)}</text>
      </g>
    })}
    {events.length > 1 && <polyline
      points={events.map((event, index) => `${xFor(event.timestamp)},${top + index * rowHeight}`).join(' ')}
      className="report-lifecycle-path"
    />}
    {events.map((event, index) => {
      const y = top + index * rowHeight
      const x = xFor(event.timestamp)
      return <g
        key={`${event.label}-${event.timestamp}`}
        className="report-chart-point"
        onMouseEnter={() => setHoveredEventIndex(index)}
        onFocus={() => setHoveredEventIndex(index)}
        onBlur={() => setHoveredEventIndex(null)}
        tabIndex="0"
        role="button"
        aria-label={`${event.label}: ${new Date(event.timestamp).toLocaleString()}`}
      >
        <circle cx={x} cy={y} r="12" className="report-chart-hit-area" />
        <circle cx={x} cy={y} r="6" className={`report-lifecycle-point report-lifecycle-point-${index % 3}`} />
      </g>
    })}
    {hoveredEventIndex !== null && (() => {
      const event = events[hoveredEventIndex]
      const x = Math.max(8, Math.min(width - 208, xFor(event.timestamp) - 100))
      const y = Math.max(4, Math.min(height - 54, top + hoveredEventIndex * rowHeight - 54))
      return <g className="report-chart-tooltip" pointerEvents="none">
        <rect x={x} y={y} width="200" height="46" rx="6" />
        <text x={x + 10} y={y + 17}>{event.label}</text>
        <text x={x + 10} y={y + 34}>{new Date(event.timestamp).toLocaleString()}</text>
      </g>
    })()}
    <line x1={left} y1={axisY} x2={right} y2={axisY} className="report-lifecycle-axis" />
  </svg>
}

function ExperimentSampleChart({ data, isPodFailure, title, unit }) {
  const [hoveredPoint, setHoveredPoint] = useState(null)
  const width = 760
  const height = 230
  const margin = { top: 12, right: 14, bottom: 38, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const timestamps = data.map((point) => point.timestamp)
  const firstTimestamp = Math.min(...timestamps)
  const lastTimestamp = Math.max(...timestamps)
  const timePadding = Math.max((lastTimestamp - firstTimestamp) * 0.04, 500)
  const timeMin = firstTimestamp - timePadding
  const timeMax = lastTimestamp + timePadding
  const yValues = data.flatMap((point) => isPodFailure
    ? [point.readyPods, point.totalPods]
    : [point.value])
  const yMax = isPodFailure
    ? Math.max(...yValues, 1)
    : Math.max(...yValues, 0.01) * 1.1
  const xFor = (timestamp) => margin.left + ((timestamp - timeMin) / (timeMax - timeMin)) * plotWidth
  const yFor = (value) => margin.top + plotHeight - (value / yMax) * plotHeight
  const series = isPodFailure
    ? [
      { key: 'totalPods', label: 'Observed pods', color: '#a89ad0' },
      { key: 'readyPods', label: 'Ready pods', color: '#7158c9' },
    ]
    : [{ key: 'value', label: title, color: '#7158c9' }]
  const timeLabel = (timestamp) => new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
  const valueLabel = (value) => isPodFailure ? String(value) : Number(value).toFixed(2)
  const yTickCount = isPodFailure ? Math.min(yMax, 4) : 4

  return <div className="report-svg-chart">
    <svg
      className="report-sample-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${title}, ${data.length} measured samples`}
      onMouseLeave={() => setHoveredPoint(null)}
    >
      {Array.from({ length: yTickCount + 1 }, (_, tick) => tick).map((tick) => {
        const value = (yMax * tick) / yTickCount
        const y = yFor(value)
        return <g key={tick}>
          <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} className="report-chart-grid" />
          <text x={margin.left - 8} y={y + 3} textAnchor="end" className="report-chart-tick">{valueLabel(value)}</text>
        </g>
      })}
      {[0, 1, 2, 3, 4].map((tick) => {
        const timestamp = timeMin + ((timeMax - timeMin) * tick) / 4
        const x = xFor(timestamp)
        const textAnchor = tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle'
        return <g key={tick}>
          <line x1={x} y1={margin.top} x2={x} y2={margin.top + plotHeight} className="report-chart-grid report-chart-grid-vertical" />
          <text x={x} y={height - 12} textAnchor={textAnchor} className="report-chart-tick">{timeLabel(timestamp)}</text>
        </g>
      })}
      {series.map(({ key, label, color }) => {
        const points = data.map((point) => ({ x: xFor(point.timestamp), y: yFor(point[key]) }))
        const path = points.length === 1
        ? ''
        : points.map((point, index) => {
          if (index === 0) return `M ${point.x} ${point.y}`
          return isPodFailure
            ? `H ${point.x} V ${point.y}`
              : `L ${point.x} ${point.y}`
          }).join(' ')
        return <g key={key}>
          {path && <path d={path} fill="none" stroke={color} strokeWidth={key === 'readyPods' || key === 'value' ? 2.5 : 1.7} strokeLinejoin="round" />}
          {points.map((point, index) => <g
            key={`${key}-${index}`}
            className="report-chart-point"
            onMouseEnter={() => setHoveredPoint({ index, key })}
            onFocus={() => setHoveredPoint({ index, key })}
            onBlur={() => setHoveredPoint(null)}
            tabIndex="0"
            role="button"
            aria-label={`${timeLabel(data[index].timestamp)} · ${label}: ${valueLabel(data[index][key])}${isPodFailure ? '' : unit}`}
          >
            <circle cx={point.x} cy={point.y} r="10" className="report-chart-hit-area" />
            <circle
              cx={point.x}
              cy={point.y}
              r={data.length === 1 ? 3.5 : 2.5}
              fill={color}
              stroke="#fff"
              strokeWidth="1"
            />
          </g>)}
        </g>
      })}
      {hoveredPoint !== null && (() => {
        const point = data[hoveredPoint.index]
        const seriesItem = series.find((item) => item.key === hoveredPoint.key)
        const x = xFor(point.timestamp)
        const y = yFor(point[hoveredPoint.key])
        const tooltipWidth = 210
        const tooltipHeight = 48
        const tooltipX = Math.max(4, Math.min(width - tooltipWidth - 4, x - tooltipWidth / 2))
        const tooltipY = y - tooltipHeight - 10 < 4 ? y + 12 : y - tooltipHeight - 10
        return <g className="report-chart-tooltip" pointerEvents="none">
          <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" />
          <text x={tooltipX + 10} y={tooltipY + 18}>{new Date(point.timestamp).toLocaleString()}</text>
          <text x={tooltipX + 10} y={tooltipY + 36}>{seriesItem?.label}: {valueLabel(point[hoveredPoint.key])}{isPodFailure ? '' : unit}</text>
        </g>
      })()}
    </svg>
    <div className="report-svg-legend">
      {series.map(({ key, label, color }) => <span key={key}><i style={{ backgroundColor: color }} />{label}</span>)}
    </div>
  </div>
}

function ExperimentReportChart({ experiment }) {
  if (experiment.status !== 'completed') return null

  const isPodFailure = experiment.type === 'pod-failure'
  const isCpuStress = experiment.type === 'cpu-stress'
  const samples = isPodFailure
    ? experiment.readinessSamples
    : isCpuStress
      ? experiment.cpuSamples
      : experiment.memorySamples
  const metricKey = isCpuStress ? 'cpu' : 'memoryMb'
  const data = (Array.isArray(samples) ? samples : [])
    .map((sample) => {
      const timestamp = Date.parse(sample?.recordedAt)
      if (!Number.isFinite(timestamp)) return null
      if (isPodFailure) {
        const readyPods = sample.readyPods
        const totalPods = sample.totalPods
        if (
          !Number.isFinite(readyPods) ||
          !Number.isFinite(totalPods) ||
          readyPods < 0 ||
          totalPods < 0 ||
          readyPods > totalPods
        ) return null
        return { timestamp, readyPods, totalPods }
      }

      const value = sample?.[metricKey]
      if (!Number.isFinite(value) || value < 0) return null
      return { timestamp, value }
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp)
  const lifecycleEvents = isPodFailure
    ? [
      ['Experiment started', experiment.startedAt],
      ['Pod failure detected', experiment.detectedAt],
      ['Replacement became ready', experiment.recoveredAt],
    ].map(([label, value]) => {
      const timestamp = Date.parse(value)
      return Number.isFinite(timestamp) ? { label, timestamp } : null
    }).filter(Boolean).sort((left, right) => left.timestamp - right.timestamp)
    : []
  const title = isPodFailure
    ? data.length > 0 ? 'Observed pod readiness' : `Recorded lifecycle · ${lifecycleEvents.length} events`
    : isCpuStress
      ? 'Measured CPU samples'
      : 'Measured memory samples'
  const unit = isCpuStress ? ' cores' : ' MB'

  return <div className="report-plot-wrap">
    <div className="report-plot-header">
      <div className="section-kicker">RECORDED EXPERIMENT DATA</div>
      <span>{title}{isPodFailure && data.length === 0 ? '' : ` · ${data.length} samples`}</span>
    </div>
    {data.length > 0
      ? <ExperimentSampleChart data={data} isPodFailure={isPodFailure} title={title} unit={unit} />
      : isPodFailure && lifecycleEvents.length > 0
        ? <LifecycleEventChart events={lifecycleEvents} />
        : <p className="report-chart-unavailable">No timestamped measurement samples were recorded for this experiment.</p>}
  </div>
}

function ResultPage({ onNavigate, onConfigure, experiment }) {
  const isPod = experiment.type === 'pod-failure'
  const isCpu = experiment.type === 'cpu-stress'
  const values = isPod ? [['Experiment ID', experiment.id], ['Target service', experiment.target], ['Old pod name', experiment.podName], ['Replacement pod name', experiment.replacementPodName], ['Status', experiment.status], ['Readiness before', experiment.readyBefore], ['Detection time', formatValue(experiment.detectionTimeMs, ' ms')], ['Recovery time', formatValue(experiment.recoveryTimeMs, ' ms')], ['Total experiment time', formatValue(experiment.totalExperimentTimeMs, ' ms')]] : [['Target service', experiment.target], ['Pod name', experiment.podName], ['Status', experiment.status], [isCpu ? 'Stress duration' : 'Requested memory', isCpu ? formatValue(experiment.stressDurationMs, ' ms') : formatValue(experiment.requestedMemoryMb, ' MB')], ...(isCpu ? [['Baseline CPU', experiment.baselineCpu], ['Peak CPU', experiment.peakCpu], ['Post-stress CPU', experiment.postStressCpu], ['CPU increase', experiment.cpuIncrease]] : [['Baseline memory', formatValue(experiment.baselineMemoryMb, ' MB')], ['Peak memory', formatValue(experiment.peakMemoryMb, ' MB')], ['Post-stress memory', formatValue(experiment.postStressMemoryMb, ' MB')], ['Memory increase', formatValue(experiment.memoryIncreaseMb, ' MB')], ['Stress duration', formatValue(experiment.stressDurationMs, ' ms')]]), ['Started', experiment.startedAt], ['Completed', experiment.completedAt], ['Total experiment time', formatValue(experiment.totalExperimentTimeMs, ' ms')]]
  return <>
    <div className="back-link-row"><button className="back-link" onClick={() => onNavigate('history')}><ArrowLeft size={14} /> Experiment history</button><span>/</span><span>Backend result</span></div>
    <div className="result-header panel">
      <div className={`result-check ${experiment.status === 'completed' ? '' : 'result-check-failed'}`}>{experiment.status === 'completed' ? <Check size={22} /> : <X size={22} />}</div>
      <div className="result-title">
        <div className="section-kicker">EXPERIMENT {experiment.status?.toUpperCase() || N_A}</div>
        <h1>{experimentLabel(experiment.type)}</h1>
        <p>{experiment.target || N_A} · {experiment.completedAt || experiment.startedAt || N_A}</p>
      </div>
    </div>
    <ResilienceScorePanel experiment={experiment} />
    <div className="result-metrics">{values.slice(0, 5).map(([label, value], index) => <MetricCard key={label} icon={index === 0 ? Activity : Server} label={label} value={formatValue(value)} note="Backend value" color={['blue', 'violet', 'cyan', 'amber', 'green'][index]} />)}</div>
    <section className="panel recovery-panel">
      <div className="panel-heading"><div><h2>Actual experiment result</h2><p>Returned by the Node.js backend</p></div></div>
      <div className="impact-list">{values.map(([label, value]) => <div key={label}><span>{label}</span><b>{formatValue(value)}</b></div>)}</div>
      <ExperimentReportChart experiment={experiment} />
    </section>
    <div className="result-actions">
      <button className="button-secondary" onClick={() => onConfigure(experiments.find((item) => item.id === (isPod ? 'pod' : isCpu ? 'cpu' : 'memory')))}><Play size={14} /> Run again</button>
      <button className="button-primary" onClick={() => onNavigate('dashboard')}>Back to dashboard <ArrowRight size={14} /></button>
    </div>
  </>
}

function HistoryPage({ history, onOpenResult }) {
  const [search, setSearch] = useState('')
  const filtered = history.filter((row) => `${experimentLabel(row.type)} ${row.target} ${row.status}`.toLowerCase().includes(search.toLowerCase()))
  return <>
    <PageHeader eyebrow="AUDIT TRAIL · BACKEND" title="Experiment history" description="Every entry below was returned by GET /api/experiments." />
    <div className="history-toolbar panel"><label className="history-search"><Search size={15} /><input placeholder="Search experiments..." value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <section className="panel history-panel">
      <div className="history-table">
        <div className="history-table-head" aria-hidden="true"><span>Experiment</span><span>Target service</span><span>Started</span><span>Duration</span><span>Status</span><span>Score</span><span /></div>
        {filtered.map((row) => <button className="history-table-row" key={row.id} onClick={() => onOpenResult(row)}>
          <span className="history-exp-name"><span className="history-exp-icon"><FlaskConical size={14} /></span><b>{experimentLabel(row.type)}</b></span>
          <span className="history-target">{formatValue(row.target)}</span>
          <span className="history-date">{formatValue(row.startedAt)}</span>
          <span className="history-duration">{formatValue(row.totalExperimentTimeMs, ' ms')}</span>
          <span className={`status-tag ${row.status === 'failed' ? 'status-failed' : ''}`}><i />{formatValue(row.status)}</span>
          <span className="history-score">{row.resilienceScore === null || row.resilienceScore === undefined ? N_A : `${row.resilienceScore}%`}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>)}
        {!filtered.length && <p className="empty-state">No backend experiments found.</p>}
      </div>
    </section>
  </>
}

function ReportsPage({ history, user, onDeleteReport }) {
  const [printReport, setPrintReport] = useState(null)
  useEffect(() => {
    if (!printReport) return undefined

    let secondFrame
    let printTimer
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        printTimer = window.setTimeout(() => window.print(), 100)
      })
    })
    const handleAfterPrint = () => setPrintReport(null)
    window.addEventListener('afterprint', handleAfterPrint)

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame)
      if (printTimer !== undefined) window.clearTimeout(printTimer)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [printReport])

  const downloadReport = (item) => {
    const reportGeneratedAt = new Date().toISOString()
    setPrintReport({
      ...item,
      reportGeneratedAt,
    })
  }
  const getReportFields = (item) => {
    const fields = [
      ['Registered user', user?.name || N_A],
      ['User email', user?.email || N_A],
      ['Report generated', item.reportGeneratedAt
        ? new Date(item.reportGeneratedAt).toLocaleString()
        : N_A],
      ['Target service', item.target],
      ['Pod name', item.podName],
      ['Status', item.status],
      ['Started', item.startedAt],
      ['Completed', item.completedAt || item.recoveredAt || item.detectedAt],
      ['Total experiment time', formatValue(item.totalExperimentTimeMs, ' ms')]
    ]
    if (item.type === 'pod-failure') return [['Experiment ID', item.id], ...fields, ['Replacement pod', item.replacementPodName], ['Readiness before', item.readyBefore], ['Detection time', formatValue(item.detectionTimeMs, ' ms')], ['Recovery time', formatValue(item.recoveryTimeMs, ' ms')]]
    if (item.type === 'cpu-stress') return [...fields, ['Stress duration', formatValue(item.stressDurationMs, ' ms')], ['Baseline CPU', item.baselineCpu], ['Peak CPU', item.peakCpu], ['Post-stress CPU', item.postStressCpu], ['CPU increase', item.cpuIncrease], ['Actual CPU samples', item.cpuSamples?.length ?? 0]]
    return [...fields, ['Requested memory', formatValue(item.requestedMemoryMb, ' MB')], ['Stress duration', formatValue(item.stressDurationMs, ' ms')], ['Baseline memory', formatValue(item.baselineMemoryMb, ' MB')], ['Peak memory', formatValue(item.peakMemoryMb, ' MB')], ['Post-stress memory', formatValue(item.postStressMemoryMb, ' MB')], ['Memory increase', formatValue(item.memoryIncreaseMb, ' MB')], ['Actual memory samples', item.memorySamples?.length ?? 0]]
  }
  const reportMarkup = (item, index = 0) => {
    return <article className="report-detail-card"><div className="report-detail-heading"><span className="history-exp-icon"><FlaskConical size={15} /></span><div><div className="section-kicker">EXPERIMENT {String(index + 1).padStart(2, '0')}</div><h3>{experimentLabel(item.type)}</h3></div><span className={`status-tag ${item.status === 'failed' ? 'status-failed' : ''}`}><i />{formatValue(item.status)}</span></div><div className="report-field-grid">{getReportFields(item).map(([label, value]) => <div key={label}><span>{label}</span><b>{formatValue(value)}</b></div>)}</div><ExperimentReportChart experiment={item} /></article>
  }
  return <><div className="report-list-screen"><PageHeader eyebrow="BACKEND RESULTS" title="Reports & analytics" description="Download a structured PDF for each completed experiment." /><section className="panel report-document"><div className="report-document-header"><div><div className="section-kicker">CHAOSGUARD · EXPERIMENT REPORTS</div><h2>Experiment results</h2><p>Select an experiment to download only its report.</p></div><div className="report-document-meta"><span>Experiments</span><b>{history.length}</b></div></div>{history.length ? <div className="report-summary-table">{history.map((item, index) => <div className="report-summary-row" key={item.id}><span className="report-summary-name"><b>{String(index + 1).padStart(2, '0')} · {experimentLabel(item.type)}</b></span><span>{formatValue(item.target)}</span><span className={`status-tag ${item.status === 'failed' ? 'status-failed' : ''}`}><i />{formatValue(item.status)}</span><span>{formatValue(item.totalExperimentTimeMs, ' ms')}</span><div className="report-row-actions"><button className="button-secondary report-row-download" onClick={() => downloadReport(item)}><Download size={13} /> PDF</button><button className="report-row-delete" aria-label={`Delete ${experimentLabel(item.type)} report`} title="Delete report" onClick={() => onDeleteReport(item)}><Trash2 size={14} /><span>Delete</span></button></div></div>)}</div> : <p className="empty-state">No backend experiments found.</p>}<p className="report-document-note">Each PDF contains only the selected experiment and its backend-returned values.</p></section></div>{printReport && <section className="report-print-document"><div className="report-print-header"><div className="section-kicker">CHAOSGUARD · EXPERIMENT REPORT</div><h1>{experimentLabel(printReport.type)}</h1></div>{reportMarkup(printReport, history.findIndex((item) => item.id === printReport.id))}<p className="report-document-note">Only values returned by the backend are included. Unavailable metrics are shown as N/A.</p></section>}</>
}


function SettingsPage({ onLogout, onToast, onUserUpdated, user }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const initials = user?.name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'U'
  const registeredAt = user?.createdAt ? new Date(user.createdAt) : null
  const memberSince = registeredAt && !Number.isNaN(registeredAt.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(registeredAt)
    : null
  const accountDetails = [
    { label: 'Workspace', value: 'ChaosGuard', icon: Building2 },
    ...(memberSince ? [{ label: 'Member since', value: memberSince, icon: CalendarDays }] : []),
    ...(user?.id ? [{ label: 'Account ID', value: user.id, icon: IdCard }] : []),
  ]
  const openEditor = () => {
    setName(user?.name || '')
    setEmail(user?.email || '')
    setEditError('')
    setEditing(true)
  }
  const saveProfile = async (event) => {
    event.preventDefault()
    setSaving(true)
    setEditError('')
    try {
      const data = await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })
      if (!data.user) throw new Error('The backend returned no updated profile.')
      onUserUpdated(data.user)
      setEditing(false)
      onToast('Profile updated successfully.')
    } catch (error) {
      setEditError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="settings-page">
      <div className="settings-page-heading">
        <span className="settings-heading-icon"><Settings size={21} /></span>
        <div>
          <h1>Settings</h1>
          <p>Manage your account and registered profile details.</p>
        </div>
      </div>

      <div className="settings-profile-card">
        <div className="settings-card-kicker">
          <span className="settings-kicker-icon"><UserRound size={16} /></span>
          <span>ACCOUNT OWNER</span>
        </div>
        <div className="settings-profile-body">
          <div className="settings-avatar" aria-hidden="true">{initials}</div>
          <div className="settings-profile-copy">
            <h2>{user?.name}</h2>
            <p>{user?.email}</p>
            <span className="settings-badge"><ShieldCheck size={14} /> Signed in</span>
          </div>
        </div>
      </div>

      <section className="settings-info-card" id="settings-profile">
        <div className="settings-section-heading">
          <span className="settings-kicker-icon"><UserRound size={16} /></span>
          <h2>PROFILE</h2>
          <button className="settings-edit-button" type="button" onClick={openEditor}>
            <Pencil size={14} /> Edit profile
          </button>
        </div>
        <div className="settings-profile-fields">
          <div><span>Full name</span><b>{user?.name}</b></div>
          <div><span>Email</span><b>{user?.email}</b></div>
          <div><span>Workspace</span><b>ChaosGuard</b></div>
        </div>
      </section>

      <section className="settings-info-card">
        <div className="settings-section-heading">
          <span className="settings-kicker-icon"><IdCard size={16} /></span>
          <h2>ACCOUNT DETAILS</h2>
        </div>
        <div className="settings-account-details">
          {accountDetails.map(({ label, value, icon: Icon }) => (
            <div className="settings-account-detail" key={label}>
              <span className="settings-detail-icon"><Icon size={17} /></span>
              <div>
                <span>{label}</span>
                <b title={label === 'Account ID' ? value : undefined}>{value}</b>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="settings-actions">
        <button className="button-secondary settings-logout" onClick={onLogout}><LogOut size={15} /> Log out</button>
      </div>
    </div>
    {editing && <div className="settings-modal-backdrop" onClick={() => !saving && setEditing(false)}>
      <section className="settings-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-edit-title" onClick={(event) => event.stopPropagation()}>
        <div className="settings-edit-heading">
          <span className="settings-kicker-icon"><UserRound size={16} /></span>
          <div><h2 id="settings-edit-title">Edit profile</h2><p>Update your registered account details.</p></div>
          <button className="icon-button settings-edit-close" type="button" aria-label="Close edit profile" disabled={saving} onClick={() => setEditing(false)}><X size={17} /></button>
        </div>
        <form onSubmit={saveProfile}>
          <label>Full name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          {editError && <p className="settings-edit-error" role="alert">{editError}</p>}
          <div className="settings-edit-actions">
            <button className="button-secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
            <button className="button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      </section>
    </div>}
  </>
}function App() {
  const [page, setPage] = useState('landing')
  const [user, setUser] = useState(null)
  const [selectedExperiment, setSelectedExperiment] = useState(experiments[0])
  const [runDetails, setRunDetails] = useState(null)
  const [runStatus, setRunStatus] = useState('Idle')
  const [runError, setRunError] = useState('')
  const [history, setHistory] = useState([])
  const [toast, setToast] = useState('')
  const loadHistory = async () => { try { const data = await apiRequest('/api/experiments'); setHistory(Array.isArray(data.experiments) ? data.experiments : []) } catch (error) { setToast(error.message) } }
  const deleteExperimentReport = async (experiment) => {
    if (!window.confirm(`Delete the ${experimentLabel(experiment.type)} report for ${experiment.target}? This also removes it from experiment history.`)) return
    try {
      await apiRequest(`/api/experiments/${encodeURIComponent(experiment.id)}`, { method: 'DELETE' })
      setHistory((currentHistory) => currentHistory.filter((item) => item.id !== experiment.id))
      setToast('Experiment report deleted.')
    } catch (error) {
      if (error.status === 401) {
        setUser(null)
        setPage('login')
        setToast('Your session expired. Sign in again, then retry deleting the report.')
        return
      }
      setToast(error.message)
    }
  }
  const signOut = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      setUser(null)
      setPage('login')
      setToast('Signed out successfully.')
    } catch (error) {
      setToast(error.message)
    }
  }
  useEffect(() => { if (user) loadHistory() }, [user])
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(timer) }, [toast])
  const navigate = (nextPage) => { if (nextPage === 'login') setUser(null); if (nextPage !== 'landing' && nextPage !== 'login' && !user) { setPage('login'); return } setPage(nextPage); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const configure = (experiment) => { setSelectedExperiment(experiment); setPage('configure') }
  const runExperiment = async (details) => {
    if (details.changeType) { const next = experiments.find((item) => item.id === details.changeType); if (next) setSelectedExperiment(next); return }
    const endpoint = selectedExperiment.id === 'pod' ? '/api/chaos/pod-failure' : selectedExperiment.id === 'cpu' ? '/api/chaos/cpu-stress' : '/api/chaos/memory-stress'
    const payload = selectedExperiment.id === 'pod' ? { target: details.target, enableHttpTrafficProbe: details.enableHttpTrafficProbe } : { target: details.target, durationMs: details.durationMs, enableHttpTrafficProbe: details.enableHttpTrafficProbe, ...(selectedExperiment.id === 'memory' ? { memoryMb: details.memoryMb } : {}) }
    setRunStatus('Running'); setRunError(''); setRunDetails({ target: details.target, name: selectedExperiment.name, type: selectedExperiment.id === 'pod' ? 'pod-failure' : selectedExperiment.id === 'cpu' ? 'cpu-stress' : 'memory-stress' }); setPage('live')
    try { const data = await apiRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!data.experiment) throw new Error('The backend returned no experiment result.'); setRunDetails(data.experiment); setRunStatus('Completed'); await loadHistory(); setPage('result')     } catch (error) {
      const failedExperiment = error.responseData?.experiment
      if (failedExperiment) {
        setRunDetails(failedExperiment)
        setRunStatus(failedExperiment.status)
        await loadHistory()
        setPage('result')
      } else {
        setRunError(error.message)
        setRunStatus('Failed')
      }
    }
  }
  const openHistoryResult = (row) => { setRunDetails(row); setSelectedExperiment(experiments.find((item) => item.id === (row.type === 'pod-failure' ? 'pod' : row.type === 'cpu-stress' ? 'cpu' : 'memory')) || experiments[0]); setPage('result') }
  if (page === 'landing') return <Landing onNavigate={navigate} />
  if (page === 'login') return <><AuthPage onAuthenticated={(authenticatedUser) => { setUser(authenticatedUser); setToast('Signed in successfully.'); setPage('dashboard') }} onToast={setToast} onBack={() => navigate('landing')} />{toast && <div className="toast"><CheckCircle2 size={16} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>}</>
  const pageContent = page === 'dashboard' ? <Overview onNavigate={navigate} history={history} /> : page === 'services' ? <ServicesPage onNavigate={navigate} /> : page === 'experiments' ? <ExperimentsPage onConfigure={configure} onNavigate={navigate} history={history} /> : page === 'configure' ? <ConfigurationPage key={selectedExperiment.id} experiment={selectedExperiment} onBack={() => navigate('experiments')} onRun={runExperiment} /> : page === 'live' ? <MonitoringPage experiment={runDetails || { name: selectedExperiment.name, target: N_A }} status={runStatus} error={runError} /> : page === 'result' ? <ResultPage onNavigate={navigate} onConfigure={configure} experiment={runDetails || { type: selectedExperiment.id }} /> : page === 'reports' ? <ReportsPage history={history} user={user} onDeleteReport={deleteExperimentReport} /> : page === 'history' ? <HistoryPage history={history} onOpenResult={openHistoryResult} /> : <SettingsPage onLogout={signOut} onToast={setToast} onUserUpdated={setUser} user={user} />
  return <><AppShell page={page} onNavigate={navigate} onToast={setToast} user={user}>{pageContent}</AppShell>{toast && <div className="toast"><CheckCircle2 size={16} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>}</>
}

export default App
