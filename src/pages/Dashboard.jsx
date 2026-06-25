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

// ── Chrome bridge helpers ─────────────────────────────────
// These communicate with the Claude in Chrome extension via
// a shared localStorage key that the extension monitors.
// The extension reads instructions and writes back results.

const CHROME_REQUEST_KEY  = 'jobagent_chrome_request'
const CHROME_RESPONSE_KEY = 'jobagent_chrome_response'
const CHROME_TIMEOUT_MS   = 30000

function sendChromeRequest(type, payload) {
  return new Promise((resolve, reject) => {
    const requestId = Date.now().toString()
    const request = { requestId, type, payload, timestamp: Date.now() }

    // Write request to localStorage for the Chrome extension to pick up
    localStorage.setItem(CHROME_REQUEST_KEY, JSON.stringify(request))

    const timeout = setTimeout(() => {
      window.removeEventListener('storage', handler)
      reject(new Error(`Chrome extension timeout — is the extension connected? (${type})`))
    }, CHROME_TIMEOUT_MS)

    function handler(e) {
      if (e.key !== CHROME_RESPONSE_KEY) return
      try {
        const response = JSON.parse(e.newValue)
        if (response.requestId !== requestId) return
        clearTimeout(timeout)
        window.removeEventListener('storage', handler)
        if (response.error) reject(new Error(response.error))
        else resolve(response.result)
      } catch (_) {}
    }

    window.addEventListener('storage', handler)
  })
}

// Open a dedicated Chrome window for job processing
async function openDedicatedWindow() {
  try {
    return await sendChromeRequest('open_window', { focused: true })
  } catch (_) {
    return null
  }
}

// Navigate to a URL in the dedicated window and get page text
async function scrapePageText(url, windowId) {
  return await sendChromeRequest('scrape_page', { url, windowId })
}

// Fill a form field in the dedicated window
async function fillFormField(instruction, windowId) {
  return await sendChromeRequest('fill_field', { instruction, windowId })
}

// Check if Chrome extension is connected
function checkChromeExtension() {
  try {
    localStorage.setItem('jobagent_ping', Date.now().toString())
    return true
  } catch (_) {
    return false
  }
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
  const [logRows, setLogRows]             = useState([])
  const [clRows, setClRows]               = useState([])
  const [needsReviewItems, setNeedsReviewItems] = useState([])
  const [stats, setStats]                 = useState({ totalJobs:0, totalFilled:0, totalSkipped:0, totalCLs:0, totalSessions:0, carryover:0 })
  const [carryover, setCarryover]         = useState([])
  const [running, setRunning]             = useState(false)
  const [sessionId, setSessionId]         = useState(null)
  const [filled, setFilled]               = useState(0)
  const [serverOk, setServerOk]           = useState(false)
  const [aiOk, setAiOk]                   = useState(false)
  const [chromeOk, setChromeOk]           = useState(false)
  const [resumeData, setResumeData]       = useState(null)
  const [clData, setClData]               = useState(null)
  const [currentStep, setCurrentStep]     = useState('')
  const [chromeWindowId, setChromeWindowId] = useState(null)
  const [copySuccess, setCopySuccess]       = useState(false)
  const [openingTabs, setOpeningTabs]       = useState(false)
  const [rerunningIndex, setRerunningIndex] = useState(null)
  const filledRef   = useRef(0)
  const cancelRef   = useRef(false)

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
      if (resume) { setResumeName(resume.file_name); setResumeUpdated(resume.updated_at); setResumeData(resume.file_data) }
      if (cl)     { setClName(cl.file_name); setClUpdated(cl.updated_at); setClData(cl.file_data) }
    }).finally(() => setFilesLoading(false))

    api.checkAIStatus().then(s => setAiOk(s.ok)).catch(() => setAiOk(false))
    setChromeOk(checkChromeExtension())
  }, [])

  useEffect(() => {
    if (serverOk) api.savePreferences({ cap, folder, boards, prefs, mode }).catch(() => {})
  }, [cap, folder, boards, prefs, mode, serverOk])

  const refreshStats = useCallback(async () => {
    const s = await api.getStats()
    setStats(s)
  }, [])

  const urlList = urls.trim() ? urls.trim().split('\n').filter(l => l.trim()) : []
  const canRun  = !!resumeName && (mode === 'auto' || urlList.length > 0) && serverOk && aiOk
  
  const readyJobs = jobs.filter(j => j.status === 'ready' || j.status === 'filled')

  // ── Open all ready application tabs in a new Chrome window ─
  // IMPORTANT: window.open must be called synchronously during the click event.
  // Any async work before window.open causes Chrome to treat it as a popup and block it.
  function openAllTabs() {
    if (!readyJobs.length) return
    setOpeningTabs(true)
    const urls = readyJobs.map(j => j.url)
    // Open all tabs synchronously — Chrome allows this during a direct click event
    urls.forEach(url => window.open(url, '_blank'))
    setOpeningTabs(false)
  }

  // ── Copy session summary for Claude chat ───────────────────
  async function copyForClaude() {
    if (!sessionId) return
    try {
      const summary = await api.getSessionSummary(sessionId)

      const lines = [
        `# Job Application Session — ${summary.session_date}`,
        ``,
        `## Instructions`,
        summary.instructions,
        ``,
        `## My Resume`,
        `File: ${summary.resume_file}`,
        `Cover letter template: ${summary.cover_letter_template}`,
        ``,
        `## Applications to Fill (${summary.ready_applications.length} total)`,
        ...summary.ready_applications.map((j, i) =>
          `${i+1}. **${j.title}** at **${j.company}**\n   URL: ${j.url}\n   Match score: ${j.score}%${j.cover_letter ? `\n   Cover letter: ${j.cover_letter}` : ''}`
        ),
        ``,
        `## My Q&A Bank`,
        ...Object.entries(summary.qa_bank).map(([cat, pairs]) =>
          `### ${cat}\n${pairs.map(p => `Q: ${p.q}\nA: ${p.a}`).join('\n\n')}`
        ),
        ``,
        `## After filling all forms:`,
        `- Leave every tab open — do NOT submit`,
        `- Note any AI detection questions that were skipped`,
        `- Flag any multiple choice answers with low confidence for my review`,
      ]

      await navigator.clipboard.writeText(lines.join('\n'))
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 3000)
    } catch (e) {
      alert('Could not copy to clipboard: ' + e.message)
    }
  }

  // ── Cancel the running session ────────────────────────────
  function cancelSession() {
    cancelRef.current = true
  }

  // ── Re-run a single cancelled job ─────────────────────────
  async function rerunJob(jobIndex) {
    const job = jobs[jobIndex]
    if (!job) return
    setRerunningIndex(jobIndex)
    cancelRef.current = false
    // Reset the job to processing state
    updateJob(jobIndex, {
      status: 'processing',
      log: ['→ Re-running job…'],
      filter_match: null, filter_legit: null, filter_age: null, filter_layoffs: null,
      score: 0, cl: null
    })
    try {
      await processJob(job.url, sessionId, filledRef.current, jobIndex, chromeWindowId)
    } finally {
      setRerunningIndex(null)
    }
  }
  const jobsRef = useRef([])
  const updateJob = useCallback((index, patch) => {
    setJobs(prev => {
      const next = [...prev]
      const idx  = index >= 0 ? index : next.length - 1
      next[idx]  = { ...next[idx], ...patch }
      jobsRef.current = next
      return next
    })
  }, [])

  // ── Mark a job as submitted ────────────────────────────────
  async function markSubmitted(jobIndex) {
    const job = jobs[jobIndex]
    if (!job?.id) {
      updateJob(jobIndex, { status: 'submitted' })
      return
    }
    try {
      await api.markJobSubmitted(job.id)
      updateJob(jobIndex, { status: 'submitted' })
      refreshStats()
    } catch (_) {
      updateJob(jobIndex, { status: 'submitted' })
    }
  }

  // ── Process a single job URL ──────────────────────────────
  async function processJob(jobUrl, sid, localFilled, jobIndex, windowId) {
    const ts = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
    const jobLog = []

    const update = (patch) => updateJob(jobIndex, patch)

    // Check if cancelled before starting
    if (cancelRef.current) {
      update({ status: 'cancelled', log: ['✗ Cancelled before processing'] })
      return { passed: false, filled: localFilled, cancelled: true }
    }

    try {
      // ── Step 1: Scrape job page via Chrome ──────────────────
      setCurrentStep(`Opening job page…`)
      update({ log: ['→ Opening job page in Chrome…'] })

      let pageText = ''
      let jobData  = {}

      if (windowId) {
        try {
          const scraped = await scrapePageText(jobUrl, windowId)
          pageText = scraped?.text || ''
          update({ log: ['→ Extracting job details…'] })
          jobData = await api.extractJobFromPage({ page_text: pageText, url: jobUrl })
        } catch (e) {
          // Chrome scraping failed — fall back gracefully
          jobLog.push(`⚠ Chrome scraping failed: ${e.message}`)
          jobLog.push('→ Continuing with URL-only matching')
          pageText = `Job posting URL: ${jobUrl}`
          jobData  = {
            title:   'Position',
            company: new URL(jobUrl).hostname.replace('www.','').split('.')[0],
            description: pageText,
            within_30_days: null
          }
        }
      } else {
        // No Chrome window — URL only mode
        jobLog.push('⚠ Chrome extension not available — using URL only')
        pageText = `Job posting URL: ${jobUrl}`
        jobData  = {
          title:   'Position',
          company: new URL(jobUrl).hostname.replace('www.','').split('.')[0],
          description: pageText,
          within_30_days: null
        }
      }

      const jobTitle      = jobData.title || 'Position'
      const company       = jobData.company || new URL(jobUrl).hostname.replace('www.','').split('.')[0]
      const jobDesc       = jobData.description || pageText
      const board         = mode === 'auto' ? 'Searching' : 'Manual'

      update({ title: jobTitle, company, log: ['→ Scoring resume match…'] })

      // ── Step 2: Extract resume text ─────────────────────────
      setCurrentStep(`Scoring match for ${company}…`)
      let resumeText = ''
      if (resumeData) {
        const extracted = await api.extractPdfText({ base64_pdf: resumeData, type: 'resume' })
        resumeText = extracted.text
      }

      // ── Step 3: Resume match ────────────────────────────────
      const matchResult = await api.matchResume({ resume_text: resumeText, job_description: jobDesc, job_title: jobTitle, company })
      const score    = matchResult.score ?? 0
      const matchPass = score >= 70

      // Cancel check after resume match
      if (cancelRef.current) {
        jobLog.push('✗ Session cancelled')
        update({ status:'cancelled', log: jobLog, score, filter_match: matchPass?1:0 })
        return { passed:false, filled:localFilled, cancelled:true }
      }

      jobLog.push(matchPass ? `✓ Score ${score}% — above threshold` : `✗ Score ${score}% — below 70% threshold`)
      if (matchResult.strengths?.length) jobLog.push(`  Strengths: ${matchResult.strengths.slice(0,2).join(', ')}`)
      if (!matchPass && matchResult.missing?.length) jobLog.push(`  Missing: ${matchResult.missing.slice(0,2).join(', ')}`)

      update({ score, filter_match: matchPass?1:0, log: [...jobLog, '→ Checking legitimacy…'] })

      if (!matchPass) {
        update({ status:'skip', log: jobLog })
        await api.createJob({ session_id:sid, title:jobTitle, company, board, url:jobUrl, query:'', discovered_at:ts, score, filter_match:0, filter_legit:null, filter_age:null, filter_layoffs:null, status:'skip', log:jobLog, carryover:0 })
        return { passed:false, filled:localFilled }
      }

      // ── Step 4: Legitimacy check ────────────────────────────
      setCurrentStep(`Checking legitimacy for ${company}…`)
      const legitResult = await api.checkLegitimacy({ job_description:jobDesc, job_title:jobTitle, company, url:jobUrl })
      const legitPass = legitResult.legitimate === true

      // Cancel check after legitimacy
      if (cancelRef.current) {
        jobLog.push('✗ Session cancelled')
        update({ status:'cancelled', log: jobLog, filter_legit: legitPass?1:0 })
        return { passed:false, filled:localFilled, cancelled:true }
      }

      jobLog.push(legitPass
        ? `✓ Legitimate posting (${legitResult.confidence}% confidence)`
        : `✗ Scam signals: ${legitResult.flags?.join(', ') || legitResult.reason}`)
      update({ filter_legit:legitPass?1:0, log:[...jobLog,'→ Checking posting age…'] })

      if (!legitPass) {
        update({ status:'skip', log:jobLog })
        await api.createJob({ session_id:sid, title:jobTitle, company, board, url:jobUrl, query:'', discovered_at:ts, score, filter_match:1, filter_legit:0, filter_age:null, filter_layoffs:null, status:'skip', log:jobLog, carryover:0 })
        return { passed:false, filled:localFilled }
      }

      // ── Step 5: Posting age ─────────────────────────────────
      setCurrentStep(`Checking posting age for ${company}…`)
      let agePass = true
      if (jobData.within_30_days === false) {
        agePass = false
        jobLog.push(`✗ Posted ${jobData.days_old} days ago — exceeds 30-day limit`)
      } else if (jobData.within_30_days === true) {
        jobLog.push(`✓ ${jobData.posted_date ? `Posted ${jobData.posted_date}` : 'Posting age OK'}`)
      } else {
        const ageResult = await api.checkPostingAge({ job_description:jobDesc, url:jobUrl })
        agePass = ageResult.within_30_days !== false
        jobLog.push(agePass
          ? `✓ ${ageResult.posted_date ? `Posted ${ageResult.posted_date}` : 'Posting age OK'}`
          : `✗ Posted ${ageResult.days_old} days ago — exceeds 30-day limit`)
      }

      // Cancel check after age
      if (cancelRef.current) {
        jobLog.push('✗ Session cancelled')
        update({ status:'cancelled', log: jobLog, filter_age: agePass?1:0 })
        return { passed:false, filled:localFilled, cancelled:true }
      }

      update({ filter_age:agePass?1:0, log:[...jobLog,'→ Checking for recent layoffs…'] })

      if (!agePass) {
        update({ status:'skip', log:jobLog })
        await api.createJob({ session_id:sid, title:jobTitle, company, board, url:jobUrl, query:'', discovered_at:ts, score, filter_match:1, filter_legit:1, filter_age:0, filter_layoffs:null, status:'skip', log:jobLog, carryover:0 })
        return { passed:false, filled:localFilled }
      }

      // ── Step 6: Layoff check ────────────────────────────────
      setCurrentStep(`Scanning layoff news for ${company}…`)
      const layoffResult = await api.checkLayoffs({ company })
      const layoffPass   = !layoffResult.had_layoffs

      // Cancel check after layoffs
      if (cancelRef.current) {
        jobLog.push('✗ Session cancelled')
        update({ status:'cancelled', log: jobLog, filter_layoffs: layoffPass?1:0 })
        return { passed:false, filled:localFilled, cancelled:true }
      }

      jobLog.push(layoffPass ? `✓ No recent layoffs found` : `✗ Layoff news found: ${layoffResult.details}`)
      update({ filter_layoffs:layoffPass?1:0, log:[...jobLog] })

      if (!layoffPass) {
        update({ status:'skip', log:jobLog })
        await api.createJob({ session_id:sid, title:jobTitle, company, board, url:jobUrl, query:'', discovered_at:ts, score, filter_match:1, filter_legit:1, filter_age:1, filter_layoffs:0, status:'skip', log:jobLog, carryover:0 })
        return { passed:false, filled:localFilled }
      }

      // ── Step 7: Daily cap check ─────────────────────────────
      if (localFilled >= cap) {
        jobLog.push(`⏸ Daily cap of ${cap} reached — added to carry-over queue`)
        update({ status:'carryover', log:jobLog, filter_layoffs:1 })
        await api.createJob({ session_id:sid, title:jobTitle, company, board, url:jobUrl, query:'', discovered_at:ts, score, filter_match:1, filter_legit:1, filter_age:1, filter_layoffs:1, status:'carryover', log:jobLog, carryover:1 })
        return { passed:true, filled:localFilled }
      }

      // ── Step 8: Generate cover letter ───────────────────────
      let clInfo = null
      if (clData) {
        setCurrentStep(`Generating cover letter for ${company}…`)
        jobLog.push('→ Generating customized cover letter…')
        update({ log:[...jobLog] })
        try {
          const clExtracted = await api.extractPdfText({ base64_pdf:clData, type:'cover_letter' })
          const clResult    = await api.generateCoverLetter({ template_text:clExtracted.text, resume_text:resumeText, job_description:jobDesc, job_title:jobTitle, company })
          const dateStr     = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'}).replace(/\//g,'')
          const companyClean = company.charAt(0).toUpperCase() + company.slice(1)
          const fileName    = `${companyClean}_${dateStr}_CL.pdf`
          const filePath    = folder ? `${folder}\\${fileName}` : fileName
          clInfo = { company, file_name:fileName, file_path:filePath, content:clResult.cover_letter }
          jobLog.push(`✓ Cover letter generated: ${fileName}`)
        } catch (e) {
          jobLog.push(`⚠ Cover letter generation failed: ${e.message}`)
        }
      }

      // ── Step 9: Save job to DB ──────────────────────────────
      localFilled++
      filledRef.current = localFilled
      setFilled(localFilled)

      const jobRecord = await api.createJob({ session_id:sid, title:jobTitle, company, board, url:jobUrl, query:'', discovered_at:ts, score, filter_match:1, filter_legit:1, filter_age:1, filter_layoffs:1, status:'ready', log:jobLog, carryover:0 })

      if (clInfo) {
        await api.addCoverLetter({ session_id:sid, job_id:jobRecord.id, company, file_name:clInfo.file_name, file_path:clInfo.file_path, board, application_url:jobUrl })
        setClRows(prev => [...prev, { ...clInfo, board, application_url:jobUrl, created_at:new Date().toLocaleString() }])
      }

      // ── Step 10: Open application page + fill form ──────────
      if (windowId) {
        setCurrentStep(`Filling application for ${company}…`)
        jobLog.push('→ Opening application page in Chrome…')
        update({ log:[...jobLog] })

        try {
          // Navigate to apply URL (may differ from job listing URL)
          const applyUrl = jobData.apply_url || jobUrl
          const appPage  = await scrapePageText(applyUrl, windowId)
          const formData = await api.extractFormFields({ page_text:appPage?.text||'', url:applyUrl })

          jobLog.push(`→ Found ${formData.fields?.length || 0} form fields — generating fill instructions…`)
          update({ log:[...jobLog] })

          const fillResult = await api.generateFillInstructions({
            form_fields: formData.fields,
            resume_text: resumeText,
            job_title:   jobTitle,
            company,
            session_id:  sid,
            job_id:      jobRecord.id
          })

          // Execute fill instructions in Chrome
          let filledCount = 0
          let skippedCount = 0
          let reviewCount = 0

          for (const inst of (fillResult.instructions || [])) {
            if (inst.skip) {
              skippedCount++
              if (inst.is_ai_detection) {
                jobLog.push(`⚠ AI detection question skipped: "${inst.field_label}"`)
              }
              continue
            }
            try {
              await fillFormField(inst, windowId)
              filledCount++
            } catch (_) {
              skippedCount++
            }
            if (inst.needs_review) reviewCount++
          }

          jobLog.push(`✓ Filled ${filledCount} fields — ${skippedCount} skipped`)
          if (reviewCount > 0) jobLog.push(`⚠ ${reviewCount} field${reviewCount!==1?'s':''} need review before submitting`)
          if (fillResult.summary?.ai_detections > 0) jobLog.push(`⚠ ${fillResult.summary.ai_detections} AI detection question${fillResult.summary.ai_detections!==1?'s':''} left blank`)
          jobLog.push('✋ Application tab left open — review and submit manually')

          // Refresh needs-review items
          if (reviewCount > 0) {
            api.getNeedsReview({ session_id: sid }).then(setNeedsReviewItems).catch(() => {})
          }

        } catch (e) {
          jobLog.push(`⚠ Form filling failed: ${e.message}`)
          jobLog.push('→ Tab left open — please fill manually')
        }
      } else {
        jobLog.push('✓ All filters passed — open URL to apply manually')
      }

      update({ status:'ready', log:jobLog, filter_layoffs:1, cl:clInfo })
      return { passed:true, filled:localFilled }

    } catch (e) {
      jobLog.push(`✗ Error: ${e.message}`)
      updateJob(jobIndex, { status:'skip', log:jobLog })
      return { passed:false, filled:localFilled }
    }
  }

  // ── Run session ───────────────────────────────────────────
  async function runAgent() {
    if (running) return
    setRunning(true)
    setJobs([]); setLogRows([]); setClRows([]); setFilled(0); setNeedsReviewItems([])
    filledRef.current = 0
    jobsRef.current   = []
    setCurrentStep('Starting session…')

    const today = new Date().toLocaleDateString('en-US')
    let sid = null
    try {
      const s = await api.createSession({ date:today, mode, cap })
      sid = s.id
      setSessionId(sid)
    } catch (_) {}

    // Open dedicated Chrome window
    let windowId = null
    if (chromeOk) {
      setCurrentStep('Opening dedicated Chrome window…')
      try {
        const win = await openDedicatedWindow()
        windowId = win?.windowId || null
        setChromeWindowId(windowId)
        if (windowId) {
          await api.createChromeSession({ session_id:sid, window_id:windowId })
        }
      } catch (e) {
        setCurrentStep('Chrome window failed — continuing without browser automation')
      }
    }

    const jobUrls = mode === 'manual' ? urlList : []
    let localFilled = 0, found = 0, matched = 0

    // Pre-populate job list with pending entries
    const pending = jobUrls.map(url => ({
      title:'Pending…', company:'…', board:'Manual', url, query:'',
      discovered_at: new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),
      score:0, filter_match:null, filter_legit:null, filter_age:null, filter_layoffs:null,
      status:'pending', log:['Waiting to process…'], cl:null
    }))
    setJobs(pending)
    jobsRef.current = pending

    cancelRef.current = false

    for (let i = 0; i < jobUrls.length; i++) {
      // Mark current job as processing
      updateJob(i, { status:'processing', log:['→ Fetching job posting…'] })
      found++
      const result = await processJob(jobUrls[i], sid, localFilled, i, windowId)
      localFilled = result.filled
      if (result.passed) matched++

      // If cancelled, mark all remaining pending jobs as cancelled
      if (cancelRef.current) {
        for (let j = i + 1; j < jobUrls.length; j++) {
          updateJob(j, {
            status: 'cancelled',
            log: ['✗ Session was cancelled before this job was processed']
          })
        }
        break
      }
    }

    cancelRef.current = false

    if (sid) {
      try { await api.updateSession(sid, { jobs_found:found, jobs_matched:matched, jobs_filled:localFilled }) } catch (_) {}
    }

    setCurrentStep('')
    setRunning(false)
    refreshStats()

    // Load final needs-review items
    if (sid) {
      api.getNeedsReview({ session_id:sid }).then(setNeedsReviewItems).catch(() => {})
    }
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
          {chromeOk
            ? <Badge type="info"><i className="ti ti-brand-chrome" /> Chrome connected</Badge>
            : <Badge type="neutral"><i className="ti ti-brand-chrome" /> Chrome not detected</Badge>
          }
          <div className="mode-toggle" role="group">
            <button className={mode==='manual'?'active':''} onClick={() => setMode('manual')}>Manual</button>
            <button className={mode==='auto'?'active':''} onClick={() => setMode('auto')}>Autonomous</button>
          </div>
          {running ? (
            <div style={{ display:'flex', gap:8 }}>
              <Button variant="secondary" disabled>
                <Spinner size={13} /> {currentStep||'Running…'}
              </Button>
              <Button variant="danger" onClick={cancelSession}>
                <i className="ti ti-player-stop" style={{ fontSize:13 }} /> Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={runAgent} disabled={!canRun} variant="primary">
              <i className="ti ti-player-play" /> Start session
            </Button>
          )}
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
                try { const saved = await api.saveFile('resume', f); setResumeData(saved.file_data); setResumeUpdated(new Date().toLocaleString()) } catch (_) {}
              }}
              onClear={async () => { setResumeName(''); setResumeUpdated(''); setResumeData(null); try { await api.deleteFile('resume') } catch (_) {} }}
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
                try { const saved = await api.saveFile('cover_letter', f); setClData(saved.file_data); setClUpdated(new Date().toLocaleString()) } catch (_) {}
              }}
              onClear={async () => { setClName(''); setClUpdated(''); setClData(null); try { await api.deleteFile('cover_letter') } catch (_) {} }}
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

          {/* Ready to Apply panel — shown when session has results */}
          {readyJobs.length > 0 && (
            <Card style={{ padding:'14px 18px', border:'1px solid rgba(52,211,153,.25)', background:'var(--green-bg)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14, color:'var(--green)' }}>
                    <i className="ti ti-circle-check" style={{ marginRight:6 }} />
                    {readyJobs.length} application{readyJobs.length!==1?'s':''} ready to apply
                  </div>
                  <div style={{ fontSize:12, color:'var(--text2)', marginTop:3 }}>
                    Open all tabs in Chrome, then copy your session summary to paste into Claude chat for auto-fill
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                  <Button size="sm" variant="secondary" onClick={openAllTabs} disabled={openingTabs}>
                    {openingTabs
                      ? <><Spinner size={12} /> Opening…</>
                      : <><i className="ti ti-external-link" style={{ fontSize:12 }} /> Open all tabs</>}
                  </Button>
                  <Button size="sm" variant="primary" onClick={copyForClaude} disabled={!sessionId}>
                    {copySuccess
                      ? <><i className="ti ti-check" style={{ fontSize:12 }} /> Copied!</>
                      : <><i className="ti ti-clipboard" style={{ fontSize:12 }} /> Copy for Claude</>}
                  </Button>
                </div>
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
                      {j.cl && <Badge type="info"><i className="ti ti-file-text" style={{ fontSize:10 }} /> CL</Badge>}
                      {j.status === 'submitted'
                        ? <Badge type="success"><i className="ti ti-send" style={{ fontSize:10 }} /> Submitted</Badge>
                        : <Button size="sm" variant="secondary" onClick={() => markSubmitted(globalIdx)}>
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
              {/* How to use Claude chat instructions */}
              <div style={{ marginTop:12, padding:'10px 12px', background:'var(--bg3)', borderRadius:'var(--radius)', fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
                <span style={{ fontWeight:500, color:'var(--text)' }}>How to use: </span>
                1. Click <strong>Open all tabs</strong> to open each application in Chrome &nbsp;·&nbsp;
                2. Click <strong>Copy for Claude</strong> to copy your session summary &nbsp;·&nbsp;
                3. Go to <a href="https://claude.ai" target="_blank" rel="noreferrer" style={{ color:'var(--blue)' }}>claude.ai</a> and paste it &nbsp;·&nbsp;
                4. Claude will fill all open tabs using your resume and Q&A answers &nbsp;·&nbsp;
                5. Come back here and mark each one submitted after you review and send
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
                              <span>{j.company}</span><span>·</span>
                              <span>{j.board}</span><span>·</span>
                              <span style={{ fontFamily:'var(--mono)' }}>{j.discovered_at}</span>
                            </div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                            {(j.status==='processing'||j.status==='pending') && <Spinner size={13} />}
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
                          {j.cl && <Badge type="info"><i className="ti ti-file-text" style={{ fontSize:11 }} /> {j.cl.file_name}</Badge>}
                        </div>
                        <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:2 }}>
                          {j.log.map((l, li) => (
                            <div key={li} style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{l}</div>
                          ))}
                        </div>
                        {j.status === 'cancelled' && (
                          <div style={{ marginTop:10 }}>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={running || rerunningIndex === i}
                              onClick={() => rerunJob(i)}
                            >
                              {rerunningIndex === i
                                ? <><Spinner size={12} /> Re-running…</>
                                : <><i className="ti ti-refresh" style={{ fontSize:12 }} /> Re-run this job</>
                              }
                            </Button>
                          </div>
                        )}
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
