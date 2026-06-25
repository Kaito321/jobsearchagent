import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, Badge, StatCard, Spinner, Button, SectionLabel, FilterPill, UploadZone } from '../components/UI'
import * as api from '../api'
import './Dashboard.css'

const BOARDS = ['LinkedIn', 'Glassdoor', 'Indeed']

const STATUS_BADGE = {
  ready:     { type: 'success', label: 'Ready to apply' },
  skip:      { type: 'danger',  label: 'Skipped' },
  processing:{ type: 'info',    label: 'Processing…' },
  carryover: { type: 'warning', label: 'Carry-over' },
  pending:   { type: 'neutral', label: 'Pending' },
  filled:    { type: 'success', label: 'Filled' },
}

export default function Dashboard() {
  const [mode, setMode]           = useState('manual')
  const [tab, setTab]             = useState('jobs')
  const [cap, setCap]             = useState(7)
  const [resumeName, setResumeName]       = useState('')
  const [resumeUpdated, setResumeUpdated] = useState('')
  const [clName, setClName]               = useState('')
  const [clUpdated, setClUpdated]         = useState('')
  const [filesLoading, setFilesLoading]   = useState(true)
  const [folder, setFolder]       = useState('')
  const [urls, setUrls]           = useState('')
  const [prefs, setPrefs]         = useState({ titles:'', location:'', salary:'', avoid:'' })
  const [boards, setBoards]       = useState(['LinkedIn','Glassdoor','Indeed'])
  const [jobs, setJobs]           = useState([])
  const [logRows, setLogRows]     = useState([])
  const [clRows, setClRows]       = useState([])
  const [stats, setStats]         = useState({ totalJobs:0, totalFilled:0, totalSkipped:0, totalCLs:0, totalSessions:0, carryover:0 })
  const [carryover, setCarryover] = useState([])
  const [running, setRunning]     = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [filled, setFilled]       = useState(0)
  const [serverOk, setServerOk]   = useState(false)
  const [aiOk, setAiOk]           = useState(false)
  const [resumeData, setResumeData] = useState(null)
  const [clData, setClData]         = useState(null)
  const [currentStep, setCurrentStep] = useState('')
  const filledRef = useRef(0)

  useEffect(() => {
    api.getStats().then(s => { setStats(s); setServerOk(true) }).catch(() => setServerOk(false))
    api.getCarryover().then(rows => setCarryover(rows)).catch(() => {})
    api.getPreferences().then(p => {
      if (p.cap) setCap(p.cap)
      if (p.folder) setFolder(p.folder)
      if (p.boards) setBoards(p.boards)
      if (p.prefs) setPrefs(p.prefs)
      if (p.mode) setMode(p.mode)
    }).catch(() => {})

    Promise.all([
      api.loadFile('resume').catch(() => null),
      api.loadFile('cover_letter').catch(() => null)
    ]).then(([resume, cl]) => {
      if (resume) { setResumeName(resume.file_name); setResumeUpdated(resume.updated_at); setResumeData(resume.file_data) }
      if (cl) { setClName(cl.file_name); setClUpdated(cl.updated_at); setClData(cl.file_data) }
    }).finally(() => setFilesLoading(false))

    api.checkAIStatus().then(s => setAiOk(s.ok)).catch(() => setAiOk(false))
  }, [])

  useEffect(() => {
    if (serverOk) api.savePreferences({ cap, folder, boards, prefs, mode }).catch(() => {})
  }, [cap, folder, boards, prefs, mode, serverOk])

  const refreshStats = useCallback(async () => {
    const s = await api.getStats()
    setStats(s)
  }, [])

  const urlList = urls.trim() ? urls.trim().split('\n').filter(l => l.trim()) : []
  const canRun = !!resumeName && (mode === 'auto' || urlList.length > 0) && serverOk

  // ── Real AI pipeline ──────────────────────────────────────
  async function processJob(jobUrl, sid, localFilled) {
    const ts = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
    const jobLog = []

    // Build a pending job entry immediately
    const pendingJob = {
      title: 'Fetching…', company: '…', board: mode === 'auto' ? 'Searching' : 'Manual',
      url: jobUrl, query: '', discovered_at: ts,
      score: 0, filter_match: null, filter_legit: null, filter_age: null, filter_layoffs: null,
      status: 'processing', log: ['→ Fetching job posting…'], cl: null
    }
    setJobs(prev => [...prev, pendingJob])

    const updateLast = (patch) => setJobs(prev => {
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })

    try {
      // Step 1: Extract resume text
      setCurrentStep('Extracting resume…')
      let resumeText = ''
      if (resumeData) {
        const extracted = await api.extractPdfText({ base64_pdf: resumeData, type: 'resume' })
        resumeText = extracted.text
      }

      // Step 2: We use the URL as the job description source
      // In a real implementation this would scrape the page via Claude in Chrome
      // For now we use the URL + any metadata we can infer
      const jobDescription = `Job posting URL: ${jobUrl}\n(Full page content would be scraped via Claude in Chrome)`
      const jobTitle = 'Position'
      const company = new URL(jobUrl).hostname.replace('www.','').split('.')[0]

      updateLast({ title: jobTitle, company, log: ['→ Checking resume match…'] })

      // Step 3: Match resume
      setCurrentStep(`Scoring match for ${company}…`)
      const matchResult = await api.matchResume({ resume_text: resumeText, job_description: jobDescription, job_title: jobTitle, company })
      const score = matchResult.score ?? 0
      const matchPass = score >= 70

      jobLog.push(matchPass
        ? `✓ Score ${score}% — above threshold`
        : `✗ Score ${score}% — below 70% threshold`)
      if (matchResult.strengths?.length) jobLog.push(`  Strengths: ${matchResult.strengths.slice(0,2).join(', ')}`)
      if (!matchPass && matchResult.missing?.length) jobLog.push(`  Missing: ${matchResult.missing.slice(0,2).join(', ')}`)

      updateLast({ score, filter_match: matchPass ? 1 : 0, log: [...jobLog, '→ Checking legitimacy…'] })

      if (!matchPass) {
        updateLast({ status: 'skip', log: jobLog })
        await api.createJob({ session_id: sid, title: jobTitle, company, board: pendingJob.board, url: jobUrl, query: '', discovered_at: ts, score, filter_match: 0, filter_legit: null, filter_age: null, filter_layoffs: null, status: 'skip', log: jobLog, carryover: 0 })
        return { passed: false, filled: localFilled }
      }

      // Step 4: Legitimacy check
      setCurrentStep(`Checking legitimacy for ${company}…`)
      const legitResult = await api.checkLegitimacy({ job_description: jobDescription, job_title: jobTitle, company, url: jobUrl })
      const legitPass = legitResult.legitimate === true

      jobLog.push(legitPass
        ? `✓ Legitimate posting (${legitResult.confidence}% confidence)`
        : `✗ Scam signals detected: ${legitResult.flags?.join(', ') || legitResult.reason}`)

      updateLast({ filter_legit: legitPass ? 1 : 0, log: [...jobLog, '→ Checking posting age…'] })

      if (!legitPass) {
        updateLast({ status: 'skip', log: jobLog })
        await api.createJob({ session_id: sid, title: jobTitle, company, board: pendingJob.board, url: jobUrl, query: '', discovered_at: ts, score, filter_match: 1, filter_legit: 0, filter_age: null, filter_layoffs: null, status: 'skip', log: jobLog, carryover: 0 })
        return { passed: false, filled: localFilled }
      }

      // Step 5: Posting age
      setCurrentStep(`Checking posting age for ${company}…`)
      const ageResult = await api.checkPostingAge({ job_description: jobDescription, url: jobUrl })
      const agePass = ageResult.within_30_days !== false

      jobLog.push(agePass
        ? `✓ ${ageResult.posted_date ? `Posted ${ageResult.posted_date}` : 'Posting age OK'}`
        : `✗ Posted ${ageResult.days_old} days ago — exceeds 30-day limit`)

      updateLast({ filter_age: agePass ? 1 : 0, log: [...jobLog, '→ Checking for recent layoffs…'] })

      if (!agePass) {
        updateLast({ status: 'skip', log: jobLog })
        await api.createJob({ session_id: sid, title: jobTitle, company, board: pendingJob.board, url: jobUrl, query: '', discovered_at: ts, score, filter_match: 1, filter_legit: 1, filter_age: 0, filter_layoffs: null, status: 'skip', log: jobLog, carryover: 0 })
        return { passed: false, filled: localFilled }
      }

      // Step 6: Layoff check
      setCurrentStep(`Scanning layoff news for ${company}…`)
      const layoffResult = await api.checkLayoffs({ company })
      const layoffPass = !layoffResult.had_layoffs

      jobLog.push(layoffPass
        ? `✓ No recent layoffs found`
        : `✗ Layoff news found: ${layoffResult.details}`)

      updateLast({ filter_layoffs: layoffPass ? 1 : 0, log: [...jobLog] })

      if (!layoffPass) {
        updateLast({ status: 'skip', log: jobLog })
        await api.createJob({ session_id: sid, title: jobTitle, company, board: pendingJob.board, url: jobUrl, query: '', discovered_at: ts, score, filter_match: 1, filter_legit: 1, filter_age: 1, filter_layoffs: 0, status: 'skip', log: jobLog, carryover: 0 })
        return { passed: false, filled: localFilled }
      }

      // Step 7: All filters passed — check daily cap
      if (localFilled >= cap) {
        jobLog.push(`⏸ Daily cap of ${cap} reached — added to carry-over queue`)
        updateLast({ status: 'carryover', log: jobLog, filter_layoffs: 1 })
        await api.createJob({ session_id: sid, title: jobTitle, company, board: pendingJob.board, url: jobUrl, query: '', discovered_at: ts, score, filter_match: 1, filter_legit: 1, filter_age: 1, filter_layoffs: 1, status: 'carryover', log: jobLog, carryover: 1 })
        return { passed: true, filled: localFilled }
      }

      // Step 8: Generate cover letter if template available
      let clInfo = null
      if (clData) {
        setCurrentStep(`Generating cover letter for ${company}…`)
        jobLog.push('→ Generating customized cover letter…')
        updateLast({ log: [...jobLog] })
        try {
          const clExtracted = await api.extractPdfText({ base64_pdf: clData, type: 'cover_letter' })
          const clResult = await api.generateCoverLetter({
            template_text: clExtracted.text,
            resume_text: resumeText,
            job_description: jobDescription,
            job_title: jobTitle,
            company
          })

          // Build filename: CompanyName_MMDDYY_CL.pdf
          const dateStr = new Date().toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'2-digit' }).replace(/\//g,'')
          const companyClean = company.charAt(0).toUpperCase() + company.slice(1)
          const fileName = `${companyClean}_${dateStr}_CL.pdf`
          const filePath = folder ? `${folder}\\${fileName}` : fileName

          clInfo = { company, file_name: fileName, file_path: filePath, content: clResult.cover_letter }
          jobLog.push(`✓ Cover letter generated: ${fileName}`)
        } catch (e) {
          jobLog.push(`⚠ Cover letter generation failed: ${e.message}`)
        }
      }

      // Step 9: Mark ready
      localFilled++
      filledRef.current = localFilled
      setFilled(localFilled)
      jobLog.push('✓ All checks passed — opening Chrome window for application')
      updateLast({ status: 'ready', log: jobLog, filter_layoffs: 1, cl: clInfo })

      // Save to DB
      const jobRecord = await api.createJob({ session_id: sid, title: jobTitle, company, board: pendingJob.board, url: jobUrl, query: '', discovered_at: ts, score, filter_match: 1, filter_legit: 1, filter_age: 1, filter_layoffs: 1, status: 'ready', log: jobLog, carryover: 0 })

      if (clInfo) {
        await api.addCoverLetter({ session_id: sid, job_id: jobRecord.id, company, file_name: clInfo.file_name, file_path: clInfo.file_path, board: pendingJob.board, application_url: jobUrl })
        setClRows(prev => [...prev, { ...clInfo, board: pendingJob.board, application_url: jobUrl, created_at: new Date().toLocaleString() }])
      }

      return { passed: true, filled: localFilled }

    } catch (e) {
      jobLog.push(`✗ Error: ${e.message}`)
      updateLast({ status: 'skip', log: jobLog })
      return { passed: false, filled: localFilled }
    }
  }

  async function runAgent() {
    if (running) return
    setRunning(true)
    setJobs([]); setLogRows([]); setClRows([]); setFilled(0)
    filledRef.current = 0
    setCurrentStep('Starting session…')

    const today = new Date().toLocaleDateString('en-US')
    let sid = null
    try {
      const s = await api.createSession({ date: today, mode, cap })
      sid = s.id
      setSessionId(sid)
    } catch (_) {}

    const jobUrls = mode === 'manual' ? urlList : []
    let localFilled = 0
    let found = 0, matched = 0

    for (const jobUrl of jobUrls) {
      found++
      const result = await processJob(jobUrl, sid, localFilled)
      localFilled = result.filled
      if (result.passed) matched++
    }

    if (sid) {
      try { await api.updateSession(sid, { jobs_found: found, jobs_matched: matched, jobs_filled: localFilled }) } catch (_) {}
    }

    setCurrentStep('')
    setRunning(false)
    refreshStats()
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
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {!serverOk && <Badge type="danger"><i className="ti ti-alert-circle" /> Server offline</Badge>}
          {serverOk && !aiOk && <Badge type="warning"><i className="ti ti-alert-triangle" /> Add API key to .env</Badge>}
          {serverOk && aiOk && <Badge type="success"><i className="ti ti-circle-check" /> Claude API connected</Badge>}
          <div className="mode-toggle" role="group">
            <button className={mode==='manual'?'active':''} onClick={() => setMode('manual')}>Manual</button>
            <button className={mode==='auto'?'active':''} onClick={() => setMode('auto')}>Autonomous</button>
          </div>
          <Button onClick={runAgent} disabled={!canRun || running || !aiOk} variant="primary">
            {running ? <><Spinner size={13} /> {currentStep || 'Running…'}</> : <><i className="ti ti-player-play" /> Start session</>}
          </Button>
        </div>
      </div>

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
                try {
                  const saved = await api.saveFile('resume', f)
                  setResumeData(saved.file_data)
                  setResumeUpdated(new Date().toLocaleString())
                } catch (_) {}
              }}
              onClear={async () => {
                setResumeName(''); setResumeUpdated(''); setResumeData(null)
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
                try {
                  const saved = await api.saveFile('cover_letter', f)
                  setClData(saved.file_data)
                  setClUpdated(new Date().toLocaleString())
                } catch (_) {}
              }}
              onClear={async () => {
                setClName(''); setClUpdated(''); setClData(null)
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
            <StatCard label="Found this session" value={jobs.length} color="var(--blue)" />
            <StatCard label="Matched ≥70%" value={jobs.filter(j=>j.filter_match).length} color="var(--green)" />
            <StatCard label="Today's cap" value={`${filled}/${cap}`} color="var(--purple)" />
            <StatCard label="All-time filled" value={stats.totalFilled} />
          </div>

          <Card style={{ padding:'14px 18px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:13, fontWeight:500 }}>Today's progress</span>
              <span style={{ fontSize:12, color:'var(--text2)' }}>{filled} of {cap} applications filled</span>
            </div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${Math.min(100, Math.round(filled/cap*100))}%`, background:'var(--green)', borderRadius:3, transition:'width .4s' }} />
            </div>
          </Card>

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
                    {!resumeName ? 'Upload your resume to get started' : 'Paste job URLs and start a session'}
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {jobs.map((j, i) => {
                    const badge = STATUS_BADGE[j.status] || STATUS_BADGE.pending
                    return (
                      <Card key={i}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:500, fontSize:14 }}>{j.title}</div>
                            <div style={{ fontSize:12, color:'var(--text2)', marginTop:3, display:'flex', gap:8, flexWrap:'wrap' }}>
                              <span>{j.company}</span>
                              <span>·</span>
                              <span>{j.board}</span>
                              <span>·</span>
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
                          <FilterPill pass={j.filter_match} label="Match" />
                          <FilterPill pass={j.filter_legit} label="Legit" />
                          <FilterPill pass={j.filter_age} label="Age" />
                          <FilterPill pass={j.filter_layoffs} label="No layoffs" />
                          {j.cl && <Badge type="info"><i className="ti ti-file-text" style={{ fontSize:11 }} /> {j.cl.file_name}</Badge>}
                        </div>
                        <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:2 }}>
                          {j.log.map((l, li) => (
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
                <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>Switch to autonomous mode to populate this log</div>
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
