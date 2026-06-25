const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const https = require('https')

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json({ limit: '50mb' }))

const DB_PATH = path.join(__dirname, '..', 'jobagent.db')

// Load .env manually (no dotenv dependency needed)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
}
loadEnv()

let db, SQL

async function initDB() {
  const initSqlJs = require('sql.js')
  SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS stored_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT UNIQUE,
      file_name TEXT, file_data TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, mode TEXT NOT NULL,
      jobs_found INTEGER DEFAULT 0, jobs_matched INTEGER DEFAULT 0,
      jobs_filled INTEGER DEFAULT 0, cap INTEGER DEFAULT 7,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, title TEXT,
      company TEXT, board TEXT, url TEXT, query TEXT, discovered_at TEXT,
      score INTEGER, filter_match INTEGER, filter_legit INTEGER, filter_age INTEGER,
      filter_layoffs INTEGER, status TEXT, log TEXT, carryover INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS discovery_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, board TEXT,
      url TEXT, query TEXT, discovered_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS cover_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, job_id INTEGER,
      company TEXT, file_name TEXT, file_path TEXT, board TEXT, application_url TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `)
  saveDB()
  console.log(`✅ Database ready: ${DB_PATH}`)
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function run(sql, params = []) {
  db.run(sql, params)
  const [{ id }] = queryAll('SELECT last_insert_rowid() as id')
  saveDB()
  return { lastInsertRowid: id }
}

// ── Claude API helper ─────────────────────────────────────
function claudeRequest(messages, system, useWebSearch = false) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY not set in .env'))

    const tools = useWebSearch ? [{ type: 'web_search_20250305', name: 'web_search' }] : undefined
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages,
      ...(tools && { tools })
    })

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      }
    }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) return reject(new Error(parsed.error.message))
          // Extract all text blocks from response
          const text = (parsed.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n')
          resolve(text)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Parse JSON safely from Claude response
function parseJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  } catch { return null }
}

// ── AI endpoints ──────────────────────────────────────────

// 1. Score resume match against job description
app.post('/api/ai/match', async (req, res) => {
  const { resume_text, job_description, job_title, company } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Resume:\n${resume_text}\n\nJob Title: ${job_title} at ${company}\nJob Description:\n${job_description}` }],
      `You are an expert resume screener. Analyze how well the resume matches the job description.
      Respond ONLY with a JSON object in this exact format, no other text:
      {
        "score": <integer 0-100>,
        "reasons": ["reason1", "reason2", "reason3"],
        "missing": ["missing skill/exp 1", "missing skill/exp 2"],
        "strengths": ["strength1", "strength2"]
      }
      Be accurate and strict. 70+ means genuinely qualified.`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 2. Check job posting legitimacy
app.post('/api/ai/legitimacy', async (req, res) => {
  const { job_description, job_title, company, url } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Job Title: ${job_title}\nCompany: ${company}\nURL: ${url}\nJob Description:\n${job_description}` }],
      `You are a job scam detector. Analyze this job posting for legitimacy.
      Red flags: vague descriptions, unrealistic pay, no company info, suspicious domains, requests for personal info upfront, grammar issues, too-good-to-be-true offers.
      Respond ONLY with a JSON object:
      {
        "legitimate": <true or false>,
        "confidence": <integer 0-100>,
        "flags": ["flag1", "flag2"],
        "reason": "brief explanation"
      }`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 3. Check for recent layoffs using web search
app.post('/api/ai/layoffs', async (req, res) => {
  const { company } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Search for recent layoffs or mass job cuts at "${company}" in the last 6 months. Then evaluate if there were significant layoffs.` }],
      `You are a job market researcher. Use web search to find if the company had significant layoffs in the last 6 months.
      Respond ONLY with a JSON object:
      {
        "had_layoffs": <true or false>,
        "confidence": <integer 0-100>,
        "details": "brief description of what you found or did not find",
        "sources": ["source1", "source2"]
      }
      Only flag as true if there were significant layoffs (hundreds+ employees or notable % of workforce).`,
      true // enable web search
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 4. Check posting age from job description text
app.post('/api/ai/posting-age', async (req, res) => {
  const { job_description, url } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Job URL: ${url}\nJob Description/Page Content:\n${job_description}` }],
      `You are analyzing a job posting to determine when it was posted.
      Look for any date indicators: "posted X days ago", "posted on [date]", timestamps, etc.
      Today's date is ${new Date().toLocaleDateString('en-US')}.
      Respond ONLY with a JSON object:
      {
        "days_old": <integer, or null if unknown>,
        "within_30_days": <true, false, or null if unknown>,
        "posted_date": "date string or null",
        "confidence": <integer 0-100>,
        "reason": "what you found"
      }`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 5. Generate customized cover letter
app.post('/api/ai/cover-letter', async (req, res) => {
  const { template_text, resume_text, job_description, job_title, company } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content:
        `Cover Letter Template:\n${template_text}\n\n` +
        `My Resume:\n${resume_text}\n\n` +
        `Job Title: ${job_title}\nCompany: ${company}\n` +
        `Job Description:\n${job_description}`
      }],
      `You are an expert cover letter writer. Using the provided template as a style and structure guide, 
      write a customized cover letter for this specific job and company.
      - Keep the same tone and length as the template
      - Highlight resume experiences most relevant to this job
      - Mention the company name and job title naturally
      - Make it feel personal and genuine, not generic
      - Do NOT include placeholder brackets like [Name] - use the actual info from the resume
      Respond with ONLY the cover letter text, no commentary or explanation.`
    )
    res.json({ cover_letter: result.trim() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 6. Extract text from base64 PDF (for resume/CL parsing)
app.post('/api/ai/extract-pdf-text', async (req, res) => {
  const { base64_pdf, type } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64_pdf }
        },
        {
          type: 'text',
          text: type === 'resume'
            ? 'Extract all text from this resume. Preserve structure. Include name, contact info, work experience, education, and skills.'
            : 'Extract all text from this cover letter template. Preserve the full text exactly.'
        }
      ]}],
      'You are a document text extractor. Extract and return the complete text content from the provided PDF document. Return only the extracted text, nothing else.'
    )
    res.json({ text: result.trim() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 7. Check API key validity
app.get('/api/ai/status', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'sk-ant-your-key-here') {
    return res.json({ ok: false, reason: 'No API key set in .env' })
  }
  try {
    await claudeRequest(
      [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      'You are a test. Respond with only the word "ok".'
    )
    res.json({ ok: true })
  } catch (e) {
    res.json({ ok: false, reason: e.message })
  }
})

// ── Stored files ──────────────────────────────────────────
app.post('/api/files/:type', (req, res) => {
  const { type } = req.params
  const { file_name, file_data } = req.body
  if (!['resume', 'cover_letter'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  db.run(
    `INSERT OR REPLACE INTO stored_files(type,file_name,file_data,updated_at) VALUES(?,?,?,datetime('now','localtime'))`,
    [type, file_name, file_data]
  )
  saveDB()
  res.json({ ok: true })
})
app.get('/api/files/:type', (req, res) => {
  const rows = queryAll('SELECT file_name, file_data, updated_at FROM stored_files WHERE type=?', [req.params.type])
  res.json(rows.length ? rows[0] : null)
})
app.delete('/api/files/:type', (req, res) => {
  db.run('DELETE FROM stored_files WHERE type=?', [req.params.type])
  saveDB(); res.json({ ok: true })
})

// ── Preferences ───────────────────────────────────────────
app.get('/api/preferences', (req, res) => {
  const rows = queryAll('SELECT key, value FROM preferences')
  const prefs = {}
  rows.forEach(r => { prefs[r.key] = JSON.parse(r.value) })
  res.json(prefs)
})
app.post('/api/preferences', (req, res) => {
  for (const [k, v] of Object.entries(req.body))
    db.run('INSERT OR REPLACE INTO preferences(key, value) VALUES(?,?)', [k, JSON.stringify(v)])
  saveDB(); res.json({ ok: true })
})

// ── Sessions ──────────────────────────────────────────────
app.get('/api/sessions', (req, res) => res.json(queryAll('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50')))
app.post('/api/sessions', (req, res) => {
  const { date, mode, cap } = req.body
  res.json({ id: run('INSERT INTO sessions(date,mode,cap) VALUES(?,?,?)', [date, mode, cap]).lastInsertRowid })
})
app.patch('/api/sessions/:id', (req, res) => {
  const { jobs_found, jobs_matched, jobs_filled } = req.body
  db.run('UPDATE sessions SET jobs_found=?,jobs_matched=?,jobs_filled=? WHERE id=?', [jobs_found, jobs_matched, jobs_filled, req.params.id])
  saveDB(); res.json({ ok: true })
})

// ── Jobs ──────────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
  const { session_id, carryover } = req.query
  let q = 'SELECT * FROM jobs WHERE 1=1'; const params = []
  if (session_id) { q += ' AND session_id=?'; params.push(session_id) }
  if (carryover !== undefined) { q += ' AND carryover=?'; params.push(carryover === 'true' ? 1 : 0) }
  res.json(queryAll(q + ' ORDER BY created_at DESC', params))
})
app.get('/api/jobs/carryover', (req, res) =>
  res.json(queryAll("SELECT * FROM jobs WHERE carryover=1 AND status!='filled' ORDER BY created_at ASC")))
app.post('/api/jobs', (req, res) => {
  const { session_id, title, company, board, url, query, discovered_at,
          score, filter_match, filter_legit, filter_age, filter_layoffs, status, log, carryover } = req.body
  const info = run(
    `INSERT INTO jobs(session_id,title,company,board,url,query,discovered_at,score,filter_match,filter_legit,filter_age,filter_layoffs,status,log,carryover) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [session_id, title, company, board, url, query, discovered_at, score,
     filter_match?1:0, filter_legit?1:0, filter_age?1:0,
     filter_layoffs===null||filter_layoffs===undefined?null:(filter_layoffs?1:0),
     status, JSON.stringify(log), carryover?1:0])
  res.json({ id: info.lastInsertRowid })
})
app.patch('/api/jobs/:id', (req, res) => {
  const allowed = ['status','carryover','filter_match','filter_legit','filter_age','filter_layoffs','log']
  const sets = [], vals = []
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k}=?`); vals.push(k==='log'?JSON.stringify(req.body[k]):req.body[k]) }
  if (!sets.length) return res.json({ ok: true })
  vals.push(req.params.id)
  db.run(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`, vals)
  saveDB(); res.json({ ok: true })
})

// ── Discovery log ─────────────────────────────────────────
app.get('/api/discovery-log', (req, res) => {
  const { session_id } = req.query
  let q = 'SELECT * FROM discovery_log'; const params = []
  if (session_id) { q += ' WHERE session_id=?'; params.push(session_id) }
  res.json(queryAll(q + ' ORDER BY created_at DESC LIMIT 200', params))
})
app.post('/api/discovery-log', (req, res) => {
  const { session_id, board, url, query, discovered_at } = req.body
  res.json({ id: run('INSERT INTO discovery_log(session_id,board,url,query,discovered_at) VALUES(?,?,?,?,?)',
    [session_id, board, url, query, discovered_at]).lastInsertRowid })
})

// ── Cover letters ─────────────────────────────────────────
app.get('/api/cover-letters', (req, res) => {
  const { session_id } = req.query
  let q = 'SELECT * FROM cover_letters'; const params = []
  if (session_id) { q += ' WHERE session_id=?'; params.push(session_id) }
  res.json(queryAll(q + ' ORDER BY created_at DESC', params))
})
app.post('/api/cover-letters', (req, res) => {
  const { session_id, job_id, company, file_name, file_path, board, application_url } = req.body
  res.json({ id: run(
    `INSERT INTO cover_letters(session_id,job_id,company,file_name,file_path,board,application_url) VALUES(?,?,?,?,?,?,?)`,
    [session_id, job_id, company, file_name, file_path, board, application_url]).lastInsertRowid })
})

// ── Stats ─────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const n = (sql) => queryAll(sql)[0]?.n ?? 0
  res.json({
    totalJobs:     n("SELECT COUNT(*) as n FROM jobs"),
    totalFilled:   n("SELECT COUNT(*) as n FROM jobs WHERE status='ready' OR status='filled'"),
    totalSkipped:  n("SELECT COUNT(*) as n FROM jobs WHERE status='skip'"),
    totalCLs:      n("SELECT COUNT(*) as n FROM cover_letters"),
    totalSessions: n("SELECT COUNT(*) as n FROM sessions"),
    carryover:     n("SELECT COUNT(*) as n FROM jobs WHERE carryover=1"),
  })
})

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ Job Agent server running at http://localhost:${PORT}`)
    console.log(`🤖 Claude API: ${process.env.ANTHROPIC_API_KEY ? 'key loaded' : '⚠️  no key found in .env'}`)
    console.log(`📦 Database: ${DB_PATH}\n`)
  })
}).catch(err => { console.error('Failed to init DB:', err); process.exit(1) })
