import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, Badge, StatCard, Spinner, Button, SectionLabel, FilterPill, UploadZone } from '../components/UI'
import * as api from '../api'
import './Dashboard.css'

const BOARDS = ['LinkedIn', 'Glassdoor', 'Indeed']

const STATUS_BADGE = {
  ready:      { type: 'success', label: 'Ready to apply' },
  skip:       { type: 'danger',  label: 'Skipped' },
  processing: { type: 'info',    label: 'Processing…' },
  carryover:  { type: 'warning', label: 'Carry-over' },
  pending:    { type: 'neutral', label: 'Pending' },
  filled:     { type: 'success', label: 'Filled' },
  submitted:  { type: 'purple',  label: 'Submitted ✓' },
  cancelled:  { type: 'danger',  label: 'Cancelled' },
}

export default function Dashboard() {
  const [mode, setMode]                   = useState('manual')
  const [tab, setTab]                     = useState('jobs')
  const [cap, setCap]                     = useState(7)
  const [resumeName, setResumeName]       = useState('')
  const [resumeUpdated, setResumeUpdated] = useState('')
  const [clName, setClName]               = useState('')
  const [clUpdated, setClUpdated]         = useState('')
  const [filesLoading, setFilesLoading]   = useState(true)
  const [folder, setFolder]               = useState('')
  const [urls, setUrls]                   = useState('')
  const [prefs, setPrefs]                 = useState({ titles:'', location:'', salary:'', avoid:'' })
  const [boards, setBoards]               = useState(['LinkedIn','Glassdoor','Indeed'])
  const [jobs, setJobs]                   = useState([])
  const [clRows, setClRows]               = useState([])
  const [logRows, setLogRows]             = useState([])
  const [needsReviewItems, setNeedsReviewItems] = useState([])
  const [stats, setStats]                 = useState({ totalJobs:0, totalFilled:0, totalSkipped:0, totalCLs:0, totalSessions:0, carryover:0 })
  const [carryover, setCarryover]         = useState([])
  const [sessionId, setSessionId]         = useState(null)
  const [filled, setFilled]               = useState(0)
  const [serverOk, setServerOk]           = useState(false)
  const [aiOk, setAiOk]                   = useState(false)
  const [launching, setLaunching]         = useState(false)
  const [polling, setPolling]             = useState(false)
  const [sessionStatus, setSessionStatus] = useState('idle') // idle | waiting | polling | done
  const [openingTabs, setOpeningTabs]     = useState(false)
  const [copySuccess, setCopySuccess]     = useState(false)
  const [blockedTabs, setBlockedTabs]     = useState([])
  const [resumingTab, setResumingTab]     = useState(null)
  const pollIntervalRef = useRef(null)
  const jobsRef = useRef([])

  // ── Load data on mount ────────────────────────────────────
  useEffect(() => {
    api.getStats().then(s => { setStats(s); setServerOk(true) }).catch(() => setServerOk(false))
    api.getCarryover().then(rows => setCarryover(rows)).catch(() => {})
    api.getPreferences().then(p => {
      if (p.cap)    setCap(p.cap)
      if (p.folder) setFolder(p.folder)
      if (p.boards) setBoards(p.boards)
      if (p.prefs)  setPrefs(p.prefs)
      if (p.mode)   setMode(p.mode)
    }).catch(() => {})
    Promise.all([
      api.loadFile('resume').catch(() => null),
      api.loadFile('cover_letter').catch(() => null)
    ]).then(([resume, cl]) => {
      if (resume) { setResumeName(resume.file_name); setResumeUpdated(resume.updated_at) }
      if (cl)     { setClName(cl.file_name); setClUpdated(cl.updated_at) }
    }).finally(() => setFilesLoading(false))
    api.checkAIStatus().then(s => setAiOk(s.ok)).catch(() => setAiOk(false))
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current) }
  }, [])

  useEffect(() => {
    if (serverOk) api.savePreferences({ cap, folder, boards, prefs, mode }).catch(() => {})
  }, [cap, folder, boards, prefs, mode, serverOk])

  const refreshStats = useCallback(async () => {
    const s = await api.getStats()
    setStats(s)
  }, [])

  const urlList   = urls.trim() ? urls.trim().split('\n').filter(l => l.trim()) : []
  const canLaunch = !!resumeName && (mode === 'auto' || urlList.length > 0) && serverOk
  const readyJobs = jobs.filter(j => j.status === 'ready' || j.status === 'filled')

  // ── Start polling for live dashboard updates ──────────────
  function startPolling(sid) {
    setPolling(true)
    setSessionStatus('running')
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    pollIntervalRef.current = setInterval(async () => {
      try {
        const data = await api.pollSessionJobs(sid)
        const newJobs = data.jobs || []
        const newCLs  = data.cover_letters || []
        setJobs(newJobs)
        jobsRef.current = newJobs
        setClRows(newCLs)
        setBlockedTabs(data.blockedTabs || [])
        setFilled(newJobs.filter(j => j.status === 'ready' || j.status === 'filled').length)
        refreshStats()
      } catch (_) {}
    }, 3000)
  }

  function stopPolling() {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
    setPolling(false)
    setSessionStatus('done')
    refreshStats()
  }

  // ── Open all ready tabs ───────────────────────────────────
  function openAllTabs() {
    if (!readyJobs.length) return
    setOpeningTabs(true)
    readyJobs.map(j => j.url).forEach(url => window.open(url, '_blank'))
    setOpeningTabs(false)
  }

  // ── Mark submitted ────────────────────────────────────────
  async function markSubmitted(jobId, jobIndex) {
    try {
      if (jobId) await api.markJobSubmitted(jobId)
      setJobs(prev => {
        const next = [...prev]
        next[jobIndex] = { ...next[jobIndex], status: 'submitted' }
        return next
      })
      refreshStats()
    } catch (_) {}
  }

  // ── Launch local Puppeteer session ─────────────────────────
  async function launchSession() {
    if (launching) return
    setLaunching(true)
    setJobs([]); setClRows([]); setFilled(0); setBlockedTabs([])
    setSessionStatus('running')
    try {
      const result = await api.startSession({
        urls: urlList, mode, cap,
        date: new Date().toLocaleDateString('en-US')
      })
      setSessionId(result.sessionId)
      startPolling(result.sessionId)
    } catch (e) {
      alert('Failed to start session: ' + e.message)
      setSessionStatus('idle')
    } finally {
      setLaunching(false)
    }
  }

  // ── Resume a blocked tab after manual CAPTCHA resolution ──
  async function resumeBlockedTab(url) {
    setResumingTab(url)
    try {
      const result = await api.recheckTab(url)
      if (result.blocked) {
        alert('Still detecting a CAPTCHA or block on that tab. Please resolve it fully, then try Resume again.')
      } else {
        setBlockedTabs(prev => prev.filter(u => u !== url))
      }
    } catch (e) {
      alert('Failed to resume tab: ' + e.message)
    } finally {
      setResumingTab(null)
    }
  }

  // ── Close the browser session entirely ─────────────────────
  async function endSession() {
    if (!confirm('Close the Chrome window for this session? Any open application tabs will be closed.')) return
    try { await api.closeSession() } catch (_) {}
    stopPolling()
    setBlockedTabs([])
  }

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })

  return (
    <div>
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1 style={{ fontSize:20, fontWeight:600 }}>Dashboard</h1>
          <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>{today}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          {!serverOk && <Badge type="danger"><i className="ti ti-alert-circle" /> Server offline</Badge>}
          {serverOk && !aiOk && <Badge type="warning"><i className="ti ti-alert-triangle" /> Add API key to .env</Badge>}
          {serverOk && aiOk && <Badge type="success"><i className="ti ti-circle-check" /> Claude API connected</Badge>}
          {polling && <Badge type="info"><Spinner size={11} /> Running in Chrome…</Badge>}
          {blockedTabs.length > 0 && (
            <Badge type="warning"><i className="ti ti-alert-triangle" /> {blockedTabs.length} tab{blockedTabs.length!==1?'s':''} need attention</Badge>
          )}
          {sessionStatus === 'done' && <Badge type="success"><i className="ti ti-circle-check" /> Session complete</Badge>}
          <div className="mode-toggle" role="group">
            <button className={mode==='manual'?'active':''} onClick={() => setMode('manual')}>Manual</button>
            <button className={mode==='auto'?'active':''} onClick={() => setMode('auto')}>Autonomous</button>
          </div>
          {polling ? (
            <Button variant="danger" onClick={endSession} size="md">
              <i className="ti ti-player-stop" style={{ fontSize:13 }} /> Close session
            </Button>
          ) : (
            <Button onClick={launchSession} disabled={!canLaunch || launching} variant="primary">
              {launching
                ? <><Spinner size={13} /> Launching Chrome…</>
                : <><i className="ti ti-brand-chrome" /> Start session</>}
            </Button>
          )}
        </div>
      </div>

      {/* Blocked tabs banner — CAPTCHA / bot-block detected, needs manual intervention */}
      {blockedTabs.length > 0 && (
        <div className="carryover-banner" style={{ background:'var(--red-bg)', borderColor:'rgba(248,113,113,.2)', marginBottom:16 }}>
          <i className="ti ti-shield-exclamation" style={{ fontSize:16, color:'var(--red)' }} />
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:500, color:'var(--red)' }}>{blockedTabs.length} tab{blockedTabs.length!==1?'s':''} blocked by CAPTCHA — waiting for you</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>
              Switch to the Chrome window, solve the CAPTCHA on each flagged tab, then click Resume below for each one.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10 }}>
              {blockedTabs.map(url => (
                <div key={url} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11 }}>
                  <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text2)' }}>{url}</span>
                  <Button size="sm" variant="secondary" onClick={() => resumeBlockedTab(url)} disabled={resumingTab === url}>
                    {resumingTab === url ? <Spinner size={11} /> : <><i className="ti ti-player-play" style={{ fontSize:11 }} /> Resume</>}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Running banner */}
      {sessionStatus === 'running' && jobs.length === 0 && (
        <div className="carryover-banner" style={{ background:'var(--blue-bg)', borderColor:'rgba(96,165,250,.2)', marginBottom:16 }}>
          <Spinner size={16} />
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:500, color:'var(--blue)' }}>Chrome window opening — processing your job list…</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>
              A visible Chrome window will appear. Dashboard updates every 3 seconds as jobs are processed.
            </div>
          </div>
        </div>
      )}

      {/* Carry-over banner */}
      {carryover.length > 0 && (
        <div className="carryover-banner">
          <i className="ti ti-clock" style={{ fontSize:16, color:'var(--amber)' }} />
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:500, color:'var(--amber)' }}>{carryover.length} job{carryover.length!==1?'s':''} carried over from previous session</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>These will be processed first</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setCarryover([])}>Clear queue</Button>
        </div>
      )}

      {/* Needs review banner */}
      {needsReviewItems.length > 0 && (
        <div className="carryover-banner" style={{ background:'var(--blue-bg)', borderColor:'rgba(96,165,250,.2)' }}>
          <i className="ti ti-eye" style={{ fontSize:16, color:'var(--blue)' }} />
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:500, color:'var(--blue)' }}>{needsReviewItems.length} form field{needsReviewItems.length!==1?'s':''} need review before submitting</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>Check the Q&A Bank → Match Log tab for details</div>
          </div>
        </div>
      )}

      <div className="dash-body">
        {/* Sidebar */}
        <div className="dash-sidebar">
          <div>
            <SectionLabel>Resume</SectionLabel>
            <UploadZone
              label={filesLoading ? 'Loading…' : 'Upload resume PDF'}
              fileName={resumeName}
              subLabel={resumeUpdated ? `Saved ${resumeUpdated}` : null}
              onFile={async f => {
                setResumeName(f.name)
                try { await api.saveFile('resume', f); setResumeUpdated(new Date().toLocaleString()) } catch (_) {}
              }}
              onClear={async () => {
                setResumeName(''); setResumeUpdated('')
                try { await api.deleteFile('resume') } catch (_) {}
              }}
            />
          </div>

          <div>
            <SectionLabel>Cover letter template</SectionLabel>
            <UploadZone
              label={filesLoading ? 'Loading…' : 'Upload base cover letter PDF'}
              fileName={clName}
              subLabel={clUpdated ? `Saved ${clUpdated}` : null}
              onFile={async f => {
                setClName(f.name)
                try { await api.saveFile('cover_letter', f); setClUpdated(new Date().toLocaleString()) } catch (_) {}
              }}
              onClear={async () => {
                setClName(''); setClUpdated('')
                try { await api.deleteFile('cover_letter') } catch (_) {}
              }}
            />
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:12, color:'var(--text2)', marginBottom:6 }}>Cover letter save folder</div>
              <div className="folder-pick" onClick={() => {
                const f = prompt('Enter full folder path:', folder || 'C:\\Users\\rosaa\\Documents\\Cover_Letters')
                if (f) setFolder(f)
              }}>
                <i className="ti ti-folder" style={{ fontSize:15, color:'var(--text3)' }} />
                <span style={{ fontSize:12, color:folder?'var(--text)':'var(--text3)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {folder || 'Choose folder…'}
                </span>
                <i className="ti ti-pencil" style={{ fontSize:12, color:'var(--text3)' }} />
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Daily application cap</SectionLabel>
            <div className="cap-row">
              <span style={{ fontSize:12, color:'var(--text3)' }}>5</span>
              <input type="range" min={5} max={10} step={1} value={cap} onChange={e => setCap(+e.target.value)} style={{ flex:1 }} />
              <span style={{ fontSize:12, color:'var(--text3)' }}>10</span>
              <span style={{ fontSize:14, fontWeight:600, color:'var(--purple)', minWidth:18 }}>{cap}</span>
            </div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>Applications per day before carry-over</div>
          </div>

          {mode === 'manual' ? (
            <div>
              <SectionLabel>Job posting URLs</SectionLabel>
              <textarea
                value={urls}
                onChange={e => setUrls(e.target.value)}
                placeholder={"Paste one URL per line\nhttps://jobs.company.com/...\nhttps://boards.greenhouse.io/..."}
                className="url-input"
              />
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:5 }}>{urlList.length} URL{urlList.length!==1?'s':''} entered</div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <SectionLabel>Search preferences</SectionLabel>
              {[
                { label:'Job title(s)', key:'titles', placeholder:'e.g. Product Manager, UX Designer' },
                { label:'Location / remote', key:'location', placeholder:'e.g. Remote, Austin TX' },
                { label:'Min. salary ($)', key:'salary', placeholder:'e.g. 90000' },
                { label:'Companies to avoid', key:'avoid', placeholder:'e.g. Acme Corp' },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>{f.label}</div>
                  <input type="text" className="pref-input" placeholder={f.placeholder}
                    value={prefs[f.key]} onChange={e => setPrefs(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:12, color:'var(--text2)', marginBottom:6 }}>Job boards</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {BOARDS.map(b => (
                    <button key={b} className={`board-chip ${boards.includes(b)?'selected':''}`}
                      onClick={() => setBoards(prev => prev.includes(b) ? prev.filter(x=>x!==b) : [...prev, b])}>
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="dash-main">
          <div className="stats-grid">
            <StatCard label="Found this session"  value={jobs.length}                              color="var(--blue)"   />
            <StatCard label="Matched ≥70%"        value={jobs.filter(j=>j.filter_match).length}    color="var(--green)"  />
            <StatCard label="Today's cap"         value={`${filled}/${cap}`}                       color="var(--purple)" />
            <StatCard label="All-time filled"     value={stats.totalFilled}                                              />
          </div>

          <Card style={{ padding:'14px 18px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:13, fontWeight:500 }}>Today's progress</span>
              <span style={{ fontSize:12, color:'var(--text2)' }}>{filled} of {cap} applications filled</span>
            </div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${Math.min(100,Math.round(filled/cap*100))}%`, background:'var(--green)', borderRadius:3, transition:'width .4s' }} />
            </div>
          </Card>

          {/* How to use — shown when no session running */}
          {sessionStatus === 'idle' && jobs.length === 0 && (
            <Card style={{ padding:'16px 18px' }}>
              <div style={{ fontWeight:500, fontSize:13, marginBottom:10 }}>
                <i className="ti ti-info-circle" style={{ color:'var(--blue)', marginRight:6 }} />
                How to start a session
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                <div><span style={{ color:'var(--purple)', fontWeight:600 }}>1.</span> Upload your resume and cover letter template in the sidebar</div>
                <div><span style={{ color:'var(--purple)', fontWeight:600 }}>2.</span> Paste your job URLs (one per line) in the sidebar</div>
                <div><span style={{ color:'var(--purple)', fontWeight:600 }}>3.</span> Click <strong>Start session</strong> — a visible Chrome window opens automatically</div>
                <div><span style={{ color:'var(--purple)', fontWeight:600 }}>4.</span> Watch this dashboard update live as each job is scraped, scored, and filtered</div>
                <div><span style={{ color:'var(--purple)', fontWeight:600 }}>5.</span> If a CAPTCHA appears, solve it in the Chrome window then click Resume here</div>
                <div><span style={{ color:'var(--purple)', fontWeight:600 }}>6.</span> Qualifying applications open automatically — review and submit manually</div>
              </div>
            </Card>
          )}

          {/* Ready to Apply panel */}
          {readyJobs.length > 0 && (
            <Card style={{ padding:'14px 18px', border:'1px solid rgba(52,211,153,.25)', background:'var(--green-bg)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14, color:'var(--green)' }}>
                    <i className="ti ti-circle-check" style={{ marginRight:6 }} />
                    {readyJobs.length} application{readyJobs.length!==1?'s':''} ready to apply
                  </div>
                  <div style={{ fontSize:12, color:'var(--text2)', marginTop:3 }}>
                    These application tabs are already open in your Chrome window — review and submit manually
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={openAllTabs} disabled={openingTabs}>
                  {openingTabs
                    ? <><Spinner size={12} /> Opening…</>
                    : <><i className="ti ti-external-link" style={{ fontSize:12 }} /> Re-open tabs in browser</>}
                </Button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {readyJobs.map((j, i) => {
                  const globalIdx = jobs.indexOf(j)
                  return (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'var(--bg2)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:500, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{j.title}</div>
                        <div style={{ fontSize:11, color:'var(--text2)' }}>{j.company} · <span style={{ color:j.score>=80?'var(--green)':j.score>=70?'var(--amber)':'var(--red)', fontWeight:600 }}>{j.score}%</span></div>
                      </div>
                      {j.status === 'submitted'
                        ? <Badge type="success"><i className="ti ti-send" style={{ fontSize:10 }} /> Submitted</Badge>
                        : <Button size="sm" variant="secondary" onClick={() => markSubmitted(j.id, globalIdx)}>
                            <i className="ti ti-send" style={{ fontSize:11 }} /> Mark submitted
                          </Button>
                      }
                      <a href={j.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)' }}>
                        <i className="ti ti-external-link" style={{ fontSize:13 }} />
                      </a>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          <div className="tab-bar">
            {[
              { id:'jobs',   label:`Jobs (${jobs.length})` },
              { id:'log',    label:`Discovery log (${logRows.length})` },
              { id:'cl-log', label:`Cover letters (${clRows.length})` },
            ].map(t => (
              <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {/* Jobs pane */}
          {tab === 'jobs' && (
            <div>
              {jobs.length === 0 ? (
                <div className="empty-state">
                  <i className="ti ti-search" style={{ fontSize:32, opacity:.3 }} />
                  <div style={{ fontSize:14, fontWeight:500, marginTop:10 }}>No jobs yet</div>
                  <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>
                    {!resumeName ? 'Upload your resume to get started' : 'Click Start session to begin'}
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {jobs.map((j, i) => {
                    const badge = STATUS_BADGE[j.status] || STATUS_BADGE.pending
                    const log   = typeof j.log === 'string' ? JSON.parse(j.log) : (j.log || [])
                    return (
                      <Card key={i}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:500, fontSize:14 }}>{j.title}</div>
                            <div style={{ fontSize:12, color:'var(--text2)', marginTop:3, display:'flex', gap:8, flexWrap:'wrap' }}>
                              <span>{j.company}</span><span>·</span>
                              <span>{j.board}</span><span>·</span>
                              <span style={{ fontFamily:'var(--mono)' }}>{j.discovered_at}</span>
                            </div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                            {j.status==='processing' && <Spinner size={13} />}
                            <Badge type={badge.type}>{badge.label}</Badge>
                            {j.score > 0 && (
                              <span style={{ fontSize:14, fontWeight:600, color:j.score>=80?'var(--green)':j.score>=70?'var(--amber)':'var(--red)' }}>{j.score}%</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:10 }}>
                          <FilterPill pass={j.filter_match}   label="Match"      />
                          <FilterPill pass={j.filter_legit}   label="Legit"      />
                          <FilterPill pass={j.filter_age}     label="Age"        />
                          <FilterPill pass={j.filter_layoffs} label="No layoffs" />
                        </div>
                        <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:2 }}>
                          {log.map((l, li) => (
                            <div key={li} style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{l}</div>
                          ))}
                        </div>
                        <div style={{ marginTop:8 }}>
                          <a href={j.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', textDecoration:'none' }}>{j.url}</a>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Discovery log pane */}
          {tab === 'log' && (
            logRows.length === 0 ? (
              <div className="empty-state">
                <i className="ti ti-list" style={{ fontSize:32, opacity:.3 }} />
                <div style={{ fontSize:14, fontWeight:500, marginTop:10 }}>No discovery log yet</div>
                <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>Used in autonomous mode</div>
              </div>
            ) : (
              <Card style={{ padding:0, overflow:'hidden' }}>
                <table className="data-table">
                  <thead><tr><th>Board</th><th>Time</th><th>Query used</th><th>URL</th></tr></thead>
                  <tbody>
                    {logRows.map((r,i) => (
                      <tr key={i}>
                        <td><Badge type="neutral">{r.board}</Badge></td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:12 }}>{r.discovered_at}</td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text2)' }}>{r.query}</td>
                        <td><a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', textDecoration:'none' }}>{r.url}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          )}

          {/* Cover letters pane */}
          {tab === 'cl-log' && (
            clRows.length === 0 ? (
              <div className="empty-state">
                <i className="ti ti-file-text" style={{ fontSize:32, opacity:.3 }} />
                <div style={{ fontSize:14, fontWeight:500, marginTop:10 }}>No cover letters generated yet</div>
                <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>Generated automatically for qualifying applications</div>
              </div>
            ) : (
              <Card style={{ padding:0, overflow:'hidden' }}>
                <table className="data-table">
                  <thead><tr><th>File</th><th>Company</th><th>Board</th><th>Application</th><th>File path</th></tr></thead>
                  <tbody>
                    {clRows.map((r,i) => (
                      <tr key={i}>
                        <td><Badge type="purple"><i className="ti ti-file-text" style={{ fontSize:11 }} /> {r.file_name}</Badge></td>
                        <td style={{ fontWeight:500 }}>{r.company}</td>
                        <td><Badge type="neutral">{r.board}</Badge></td>
                        <td><a href={r.application_url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', textDecoration:'none' }}>{r.application_url}</a></td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text3)' }}>{r.file_path}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  )
}
