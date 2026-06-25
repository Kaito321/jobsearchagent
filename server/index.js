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
    db = new SQL.Database(fs.readFileSync(DB_PATH))
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
    CREATE TABLE IF NOT EXISTS qa_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(category_id) REFERENCES qa_categories(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS qa_match_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER, session_id INTEGER,
      application_question TEXT, matched_question TEXT, matched_answer TEXT,
      confidence INTEGER, category_name TEXT,
      question_type TEXT DEFAULT 'text',
      available_options TEXT,
      selected_option TEXT,
      is_background_check INTEGER DEFAULT 0,
      is_ai_detection INTEGER DEFAULT 0,
      was_skipped INTEGER DEFAULT 0,
      needs_review INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS chrome_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      window_id TEXT,
      status TEXT DEFAULT 'active',
      jobs_scraped INTEGER DEFAULT 0,
      jobs_filled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `)
  runMigrations()
  saveDB()
  seedQAIfEmpty()
  console.log(`✅ Database ready: ${DB_PATH}`)
}

// ── Migrations — safely add new columns to existing DBs ──
// Uses ALTER TABLE only if the column doesn't already exist.
// Add new migrations here whenever a patch adds new columns.
function runMigrations() {
  const migrations = [
    // Chrome patch — qa_match_log new columns
    { table: 'qa_match_log', column: 'question_type',      sql: "ALTER TABLE qa_match_log ADD COLUMN question_type TEXT DEFAULT 'text'" },
    { table: 'qa_match_log', column: 'available_options',  sql: 'ALTER TABLE qa_match_log ADD COLUMN available_options TEXT' },
    { table: 'qa_match_log', column: 'selected_option',    sql: 'ALTER TABLE qa_match_log ADD COLUMN selected_option TEXT' },
    { table: 'qa_match_log', column: 'is_background_check',sql: 'ALTER TABLE qa_match_log ADD COLUMN is_background_check INTEGER DEFAULT 0' },
    { table: 'qa_match_log', column: 'needs_review',       sql: 'ALTER TABLE qa_match_log ADD COLUMN needs_review INTEGER DEFAULT 0' },
    // Chrome sessions table — added in Chrome patch
    { table: 'chrome_sessions', column: 'window_id', sql: `CREATE TABLE IF NOT EXISTS chrome_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER,
      window_id TEXT, status TEXT DEFAULT 'active',
      jobs_scraped INTEGER DEFAULT 0, jobs_filled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )` },
    // Jobs patch — submitted status (no schema change needed, just a value)
  ]

  // Get existing columns for each table once
  const columnCache = {}
  function getColumns(table) {
    if (columnCache[table]) return columnCache[table]
    try {
      const rows = queryAll(`PRAGMA table_info(${table})`)
      columnCache[table] = rows.map(r => r.name)
    } catch (_) {
      columnCache[table] = []
    }
    return columnCache[table]
  }

  let ran = 0
  for (const m of migrations) {
    const cols = getColumns(m.table)
    // For CREATE TABLE migrations, check if table exists
    if (m.sql.trim().toUpperCase().startsWith('CREATE TABLE')) {
      try { db.run(m.sql); ran++ } catch (_) {}
      continue
    }
    // For ALTER TABLE migrations, check if column already exists
    if (!cols.includes(m.column)) {
      try {
        db.run(m.sql)
        columnCache[m.table] = null // invalidate cache
        ran++
        console.log(`  ✓ Migration: added ${m.table}.${m.column}`)
      } catch (e) {
        console.warn(`  ⚠ Migration skipped (${m.table}.${m.column}): ${e.message}`)
      }
    }
  }
  if (ran > 0) console.log(`✅ Ran ${ran} database migration${ran!==1?'s':''}`)
}

function seedQAIfEmpty() {
  const count = queryAll('SELECT COUNT(*) as n FROM qa_categories')[0]?.n ?? 0
  if (count > 0) return
  const categories = [
    { name: 'Work Authorization & Background', pairs: [
      { q: 'Are you authorized to work in the United States?', a: 'Yes, I am authorized to work in the United States.' },
      { q: 'Will you now or in the future require sponsorship?', a: 'No, I do not require sponsorship now or in the future.' },
      { q: 'Have you ever been convicted of a felony?', a: 'No.' },
      { q: 'Are you willing to undergo a background check?', a: 'Yes, I am willing to undergo a background check.' },
    ]},
    { name: 'Availability & Schedule', pairs: [
      { q: 'What is your available start date?', a: 'I am available to start with two weeks notice.' },
      { q: 'Are you willing to work overtime?', a: 'Yes, I am open to overtime when needed.' },
      { q: 'Are you willing to travel?', a: 'Yes, I am willing to travel up to 25% of the time.' },
      { q: 'Are you open to remote, hybrid, or in-office work?', a: 'I am open to remote and hybrid arrangements.' },
    ]},
    { name: 'Salary & Compensation', pairs: [
      { q: 'What are your salary expectations?', a: 'I am looking for a competitive salary in the range of $85,000 - $110,000 depending on the full compensation package.' },
      { q: 'What is your current salary?', a: 'I prefer to discuss compensation expectations rather than current salary, but I am targeting $85,000 - $110,000.' },
      { q: 'Are you open to negotiation on salary?', a: 'Yes, I am open to discussing the full compensation package.' },
    ]},
    { name: 'Experience & Skills', pairs: [
      { q: 'How many years of experience do you have?', a: 'Please refer to my resume for a full breakdown of my experience.' },
      { q: 'Describe your greatest professional achievement.', a: 'One of my proudest achievements was leading a cross-functional project that resulted in measurable improvements to team efficiency and product quality.' },
      { q: 'Why are you leaving your current job?', a: 'I am looking for new challenges and opportunities to grow my skills in a role that aligns with my long-term career goals.' },
      { q: 'Why do you want to work here?', a: 'I am excited about the opportunity to contribute my skills to your team and am particularly drawn to the company\'s mission and culture.' },
    ]},
    { name: 'References & Miscellaneous', pairs: [
      { q: 'Can you provide professional references?', a: 'Yes, I can provide professional references upon request.' },
      { q: 'How did you hear about this position?', a: 'I found this position through an online job board.' },
      { q: 'Are you currently employed?', a: 'I prefer to discuss my current situation during an interview.' },
    ]},
  ]
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i]
    db.run('INSERT INTO qa_categories(name, sort_order) VALUES(?,?)', [cat.name, i])
    const [{ id: catId }] = queryAll('SELECT last_insert_rowid() as id')
    for (const pair of cat.pairs) {
      db.run('INSERT INTO qa_pairs(category_id, question, answer) VALUES(?,?,?)', [catId, pair.q, pair.a])
    }
  }
  saveDB()
  console.log('✅ Q&A bank seeded with default entries')
}

function saveDB() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())) }

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
      model: 'claude-sonnet-4-6', max_tokens: 1024, system, messages,
      ...(tools && { tools })
    })
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': apiKey,
        'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05'
      }
    }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) return reject(new Error(parsed.error.message))
          const text = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
          resolve(text)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body); req.end()
  })
}

function parseJSON(text) {
  try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null }
  catch { return null }
}

// ── Chrome integration endpoints ──────────────────────────

// Receive raw page content from Chrome extension and extract job data
app.post('/api/chrome/extract-job', async (req, res) => {
  const { page_text, page_html, url } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `URL: ${url}\n\nPage content:\n${page_text?.slice(0, 8000)}` }],
      `You are a job posting parser. Extract structured data from this job posting page.
      Respond ONLY with a JSON object:
      {
        "title": "job title",
        "company": "company name",
        "location": "location or Remote",
        "description": "full job description text",
        "requirements": ["requirement 1", "requirement 2"],
        "posted_date": "date string or null",
        "days_old": <integer or null>,
        "within_30_days": <true|false|null>,
        "salary": "salary range or null",
        "job_type": "Full-time/Part-time/Contract or null",
        "apply_url": "direct application URL if different from current URL, or null"
      }
      If this page is not a job posting, set title to null.`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Could not parse job data' })
    res.json(parsed)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Extract all form fields from an application page
app.post('/api/chrome/extract-form', async (req, res) => {
  const { page_text, page_html, url } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Application page URL: ${url}\n\nPage content:\n${page_text?.slice(0, 8000)}` }],
      `You are a job application form analyzer. Extract all form fields from this application page.
      Respond ONLY with a JSON object:
      {
        "fields": [
          {
            "id": "field identifier or name attribute",
            "label": "field label text",
            "type": "text|email|phone|textarea|select|radio|checkbox|file|date",
            "required": true|false,
            "options": ["option1", "option2"] // only for select/radio/checkbox
          }
        ],
        "has_resume_upload": true|false,
        "has_cover_letter_upload": true|false,
        "is_multi_page": true|false
      }`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Could not parse form fields' })
    res.json(parsed)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Generate fill instructions for a form given resume + Q&A bank
app.post('/api/chrome/generate-fill-instructions', async (req, res) => {
  const { form_fields, resume_text, job_title, company, session_id, job_id } = req.body
  try {
    // Get Q&A bank
    const pairs = queryAll(`
      SELECT qa_pairs.*, qa_categories.name as category_name 
      FROM qa_pairs JOIN qa_categories ON qa_pairs.category_id = qa_categories.id
    `)

    // Background check keywords for auto-approve logic
    const bgKeywords = ['background check','authorized to work','work authorization',
      'sponsorship','felony','criminal','drug test','convicted','eligible to work']
    const aiKeywords = ['are you an ai','are you ai','are you a bot','are you human',
      'was this filled by ai','did you use ai','ai assistance','artificial intelligence',
      'automated application','confirm you are human']

    const result = await claudeRequest(
      [{ role: 'user', content:
        `Resume:\n${resume_text}\n\n` +
        `Job: ${job_title} at ${company}\n\n` +
        `Q&A Bank:\n${JSON.stringify(pairs.map(p => ({ q: p.question, a: p.answer, cat: p.category_name })))}\n\n` +
        `Form fields to fill:\n${JSON.stringify(form_fields)}`
      }],
      `You are a job application assistant. Generate fill instructions for each form field.
      Use the resume for personal info (name, email, phone, address, work history, education, skills).
      Use the Q&A bank for application questions.
      For select/radio/checkbox fields, pick the best matching option.

      Respond ONLY with a JSON object:
      {
        "instructions": [
          {
            "field_id": "field identifier",
            "field_label": "field label",
            "field_type": "text|email|phone|textarea|select|radio|checkbox|file|date",
            "value": "value to fill or option to select",
            "available_options": ["opt1","opt2"] // for select/radio/checkbox only
            "confidence": <0-100>,
            "source": "resume|qa_bank|generated",
            "matched_qa_question": "which Q&A question matched, or null",
            "is_ai_detection": true|false,
            "is_background_check": true|false,
            "skip": true|false,
            "skip_reason": "reason if skip is true, else null",
            "needs_review": true|false
          }
        ]
      }

      Rules:
      - Mark is_ai_detection=true and skip=true for any question asking if applicant is AI/human/bot
      - Mark is_background_check=true for background check, work authorization, felony, drug test questions
      - For background check questions with options: auto-select based on Q&A answer, needs_review=false
      - For non-background-check select/radio with confidence >= 85: needs_review=false
      - For non-background-check select/radio with confidence 50-84: needs_review=true
      - For non-background-check select/radio with confidence < 50: skip=true, needs_review=true
      - For file upload fields: skip=true (handled separately)
      - Never fill fields you are not confident about`
    )

    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Could not generate fill instructions' })

    // Log all instructions to qa_match_log
    for (const inst of (parsed.instructions || [])) {
      db.run(`
        INSERT INTO qa_match_log(
          job_id, session_id, application_question, matched_question, matched_answer,
          confidence, category_name, question_type, available_options, selected_option,
          is_background_check, is_ai_detection, was_skipped, needs_review
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          job_id || null, session_id || null,
          inst.field_label, inst.matched_qa_question, inst.value,
          inst.confidence, inst.source,
          inst.field_type,
          inst.available_options ? JSON.stringify(inst.available_options) : null,
          inst.value,
          inst.is_background_check ? 1 : 0,
          inst.is_ai_detection ? 1 : 0,
          inst.skip ? 1 : 0,
          inst.needs_review ? 1 : 0
        ]
      )
    }
    saveDB()

    // Build summary counts for dashboard
    const summary = {
      total: parsed.instructions?.length || 0,
      filled: parsed.instructions?.filter(i => !i.skip).length || 0,
      skipped: parsed.instructions?.filter(i => i.skip).length || 0,
      needs_review: parsed.instructions?.filter(i => i.needs_review).length || 0,
      ai_detections: parsed.instructions?.filter(i => i.is_ai_detection).length || 0,
    }

    res.json({ instructions: parsed.instructions, summary })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Log chrome session window
app.post('/api/chrome/sessions', (req, res) => {
  const { session_id, window_id } = req.body
  const info = run('INSERT INTO chrome_sessions(session_id, window_id) VALUES(?,?)', [session_id, window_id || 'dedicated'])
  res.json({ id: info.lastInsertRowid })
})

app.patch('/api/chrome/sessions/:id', (req, res) => {
  const { status, jobs_scraped, jobs_filled } = req.body
  const sets = [], vals = []
  if (status !== undefined) { sets.push('status=?'); vals.push(status) }
  if (jobs_scraped !== undefined) { sets.push('jobs_scraped=?'); vals.push(jobs_scraped) }
  if (jobs_filled !== undefined) { sets.push('jobs_filled=?'); vals.push(jobs_filled) }
  if (!sets.length) return res.json({ ok: true })
  vals.push(req.params.id)
  db.run(`UPDATE chrome_sessions SET ${sets.join(',')} WHERE id=?`, vals)
  saveDB(); res.json({ ok: true })
})

// Get needs-review items for a session
app.get('/api/chrome/needs-review', (req, res) => {
  const { session_id } = req.query
  let q = `SELECT qa_match_log.*, jobs.title as job_title, jobs.company, jobs.url as job_url
           FROM qa_match_log LEFT JOIN jobs ON qa_match_log.job_id = jobs.id
           WHERE qa_match_log.needs_review=1`
  const params = []
  if (session_id) { q += ' AND qa_match_log.session_id=?'; params.push(session_id) }
  q += ' ORDER BY qa_match_log.created_at DESC'
  res.json(queryAll(q, params))
})

// ── AI endpoints ──────────────────────────────────────────
app.post('/api/ai/match', async (req, res) => {
  const { resume_text, job_description, job_title, company } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Resume:\n${resume_text}\n\nJob Title: ${job_title} at ${company}\nJob Description:\n${job_description}` }],
      `You are an expert resume screener. Analyze how well the resume matches the job description.
      Respond ONLY with a JSON object:
      { "score": <0-100>, "reasons": ["..."], "missing": ["..."], "strengths": ["..."] }
      Be accurate and strict. 70+ means genuinely qualified.`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/legitimacy', async (req, res) => {
  const { job_description, job_title, company, url } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Job Title: ${job_title}\nCompany: ${company}\nURL: ${url}\nJob Description:\n${job_description}` }],
      `You are a job scam detector. Analyze this job posting for legitimacy.
      Respond ONLY with a JSON object:
      { "legitimate": <true|false>, "confidence": <0-100>, "flags": ["..."], "reason": "..." }`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/layoffs', async (req, res) => {
  const { company } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Search for recent layoffs at "${company}" in the last 6 months.` }],
      `You are a job market researcher. Use web search to check for significant layoffs in the last 6 months.
      Respond ONLY with a JSON object:
      { "had_layoffs": <true|false>, "confidence": <0-100>, "details": "...", "sources": ["..."] }`,
      true
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/posting-age', async (req, res) => {
  const { job_description, url } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Job URL: ${url}\nContent:\n${job_description}` }],
      `Determine when this job was posted. Today is ${new Date().toLocaleDateString('en-US')}.
      Respond ONLY with a JSON object:
      { "days_old": <integer|null>, "within_30_days": <true|false|null>, "posted_date": "...", "confidence": <0-100>, "reason": "..." }`
    )
    const parsed = parseJSON(result)
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' })
    res.json(parsed)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/cover-letter', async (req, res) => {
  const { template_text, resume_text, job_description, job_title, company } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: `Template:\n${template_text}\n\nResume:\n${resume_text}\n\nJob: ${job_title} at ${company}\nDescription:\n${job_description}` }],
      `Write a customized cover letter using the template as a style guide. Use info from the resume.
      Mention the company and role naturally. No placeholder brackets. Return only the cover letter text.`
    )
    res.json({ cover_letter: result.trim() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/extract-pdf-text', async (req, res) => {
  const { base64_pdf, type } = req.body
  try {
    const result = await claudeRequest(
      [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64_pdf } },
        { type: 'text', text: type === 'resume'
          ? 'Extract all text from this resume. Preserve structure including name, contact info, work experience, education, and skills.'
          : 'Extract all text from this cover letter template. Return the full text exactly.' }
      ]}],
      'Extract and return the complete text content from the PDF. Return only the extracted text.'
    )
    res.json({ text: result.trim() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/match-qa', async (req, res) => {
  const { application_questions, job_id, session_id } = req.body
  try {
    const pairs = queryAll('SELECT qa_pairs.*, qa_categories.name as category_name FROM qa_pairs JOIN qa_categories ON qa_pairs.category_id = qa_categories.id')
    if (!pairs.length) return res.json({ matches: [], ai_detections: [] })
    const qaBank = pairs.map(p => ({ id: p.id, category: p.category_name, question: p.question, answer: p.answer }))
    const aiKeywords = ['are you an ai','are you ai','are you a bot','are you human','are you a human','was this filled by ai','did you use ai','ai assistance','artificial intelligence','automated application','did a human fill','confirm you are human']
    const aiDetections = []
    const regularQuestions = []
    for (const q of application_questions) {
      const lower = q.toLowerCase()
      if (aiKeywords.some(kw => lower.includes(kw))) aiDetections.push(q)
      else regularQuestions.push(q)
    }
    for (const q of aiDetections) {
      db.run(`INSERT INTO qa_match_log(job_id,session_id,application_question,matched_question,matched_answer,confidence,category_name,is_ai_detection,was_skipped) VALUES(?,?,?,?,?,?,?,?,?)`,
        [job_id||null, session_id||null, q, null, null, null, 'AI Detection', 1, 1])
    }
    let matches = []
    if (regularQuestions.length > 0) {
      const result = await claudeRequest(
        [{ role: 'user', content: `Questions:\n${regularQuestions.map((q,i)=>`${i+1}. ${q}`).join('\n')}\n\nQ&A Bank:\n${JSON.stringify(qaBank,null,2)}` }],
        `Match each question to the best Q&A bank entry. Respond ONLY with JSON:
        { "matches": [{ "application_question":"...","matched_id":<id|null>,"matched_question":"...","matched_answer":"...","category":"...","confidence":<0-100>,"reasoning":"..." }] }`
      )
      const parsed = parseJSON(result)
      matches = parsed?.matches || []
      for (const m of matches) {
        db.run(`INSERT INTO qa_match_log(job_id,session_id,application_question,matched_question,matched_answer,confidence,category_name,is_ai_detection,was_skipped) VALUES(?,?,?,?,?,?,?,?,?)`,
          [job_id||null, session_id||null, m.application_question, m.matched_question, m.matched_answer, m.confidence, m.category, 0, m.matched_id?0:1])
      }
    }
    saveDB()
    res.json({ matches, ai_detections: aiDetections })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/ai/status', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'sk-ant-your-key-here') return res.json({ ok: false, reason: 'No API key set in .env' })
  try {
    await claudeRequest([{ role: 'user', content: 'Say "ok".' }], 'Respond with only "ok".')
    res.json({ ok: true })
  } catch (e) { res.json({ ok: false, reason: e.message }) }
})

// ── Q&A Categories ────────────────────────────────────────
app.get('/api/qa/categories', (req, res) => {
  const cats = queryAll('SELECT * FROM qa_categories ORDER BY sort_order, created_at')
  const pairs = queryAll('SELECT * FROM qa_pairs ORDER BY created_at')
  res.json(cats.map(c => ({ ...c, pairs: pairs.filter(p => p.category_id === c.id) })))
})
app.post('/api/qa/categories', (req, res) => {
  const { name } = req.body
  const maxOrder = queryAll('SELECT MAX(sort_order) as m FROM qa_categories')[0]?.m ?? 0
  const info = run('INSERT INTO qa_categories(name, sort_order) VALUES(?,?)', [name, maxOrder + 1])
  res.json({ id: info.lastInsertRowid, name, pairs: [] })
})
app.patch('/api/qa/categories/:id', (req, res) => {
  db.run('UPDATE qa_categories SET name=? WHERE id=?', [req.body.name, req.params.id])
  saveDB(); res.json({ ok: true })
})
app.delete('/api/qa/categories/:id', (req, res) => {
  db.run('DELETE FROM qa_pairs WHERE category_id=?', [req.params.id])
  db.run('DELETE FROM qa_categories WHERE id=?', [req.params.id])
  saveDB(); res.json({ ok: true })
})

// ── Q&A Pairs ─────────────────────────────────────────────
app.post('/api/qa/pairs', (req, res) => {
  const { category_id, question, answer } = req.body
  const info = run('INSERT INTO qa_pairs(category_id, question, answer) VALUES(?,?,?)', [category_id, question, answer])
  res.json({ id: info.lastInsertRowid, category_id, question, answer })
})
app.patch('/api/qa/pairs/:id', (req, res) => {
  db.run('UPDATE qa_pairs SET question=?, answer=? WHERE id=?', [req.body.question, req.body.answer, req.params.id])
  saveDB(); res.json({ ok: true })
})
app.delete('/api/qa/pairs/:id', (req, res) => {
  db.run('DELETE FROM qa_pairs WHERE id=?', [req.params.id])
  saveDB(); res.json({ ok: true })
})

// ── Q&A Match log ─────────────────────────────────────────
app.get('/api/qa/match-log', (req, res) => {
  const { job_id, session_id } = req.query
  let q = 'SELECT * FROM qa_match_log WHERE 1=1'; const params = []
  if (job_id) { q += ' AND job_id=?'; params.push(job_id) }
  if (session_id) { q += ' AND session_id=?'; params.push(session_id) }
  res.json(queryAll(q + ' ORDER BY created_at DESC', params))
})

// ── Stored files ──────────────────────────────────────────
app.post('/api/files/:type', (req, res) => {
  const { type } = req.params; const { file_name, file_data } = req.body
  if (!['resume','cover_letter'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  db.run(`INSERT OR REPLACE INTO stored_files(type,file_name,file_data,updated_at) VALUES(?,?,?,datetime('now','localtime'))`, [type, file_name, file_data])
  saveDB(); res.json({ ok: true })
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
  const prefs = {}; rows.forEach(r => { prefs[r.key] = JSON.parse(r.value) })
  res.json(prefs)
})
app.post('/api/preferences', (req, res) => {
  for (const [k,v] of Object.entries(req.body))
    db.run('INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)', [k, JSON.stringify(v)])
  saveDB(); res.json({ ok: true })
})

// ── Sessions ──────────────────────────────────────────────
app.get('/api/sessions', (req, res) => res.json(queryAll('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50')))
app.post('/api/sessions', (req, res) => {
  const { date, mode, cap } = req.body
  res.json({ id: run('INSERT INTO sessions(date,mode,cap) VALUES(?,?,?)', [date,mode,cap]).lastInsertRowid })
})
app.patch('/api/sessions/:id', (req, res) => {
  const { jobs_found, jobs_matched, jobs_filled } = req.body
  db.run('UPDATE sessions SET jobs_found=?,jobs_matched=?,jobs_filled=? WHERE id=?', [jobs_found,jobs_matched,jobs_filled,req.params.id])
  saveDB(); res.json({ ok: true })
})

// ── Jobs ──────────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
  const { session_id, carryover } = req.query
  let q = 'SELECT * FROM jobs WHERE 1=1'; const params = []
  if (session_id) { q += ' AND session_id=?'; params.push(session_id) }
  if (carryover !== undefined) { q += ' AND carryover=?'; params.push(carryover==='true'?1:0) }
  res.json(queryAll(q + ' ORDER BY created_at DESC', params))
})
app.get('/api/jobs/carryover', (req, res) =>
  res.json(queryAll("SELECT * FROM jobs WHERE carryover=1 AND status!='filled' ORDER BY created_at ASC")))
app.post('/api/jobs', (req, res) => {
  const { session_id,title,company,board,url,query,discovered_at,score,filter_match,filter_legit,filter_age,filter_layoffs,status,log,carryover } = req.body
  const info = run(
    `INSERT INTO jobs(session_id,title,company,board,url,query,discovered_at,score,filter_match,filter_legit,filter_age,filter_layoffs,status,log,carryover) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [session_id,title,company,board,url,query,discovered_at,score,
     filter_match?1:0, filter_legit?1:0, filter_age?1:0,
     filter_layoffs===null||filter_layoffs===undefined?null:(filter_layoffs?1:0),
     status, JSON.stringify(log), carryover?1:0])
  res.json({ id: info.lastInsertRowid })
})
app.patch('/api/jobs/:id', (req, res) => {
  const allowed = ['status','carryover','filter_match','filter_legit','filter_age','filter_layoffs','log']
  const sets = [], vals = []
  for (const k of allowed) if (req.body[k]!==undefined) { sets.push(`${k}=?`); vals.push(k==='log'?JSON.stringify(req.body[k]):req.body[k]) }
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
  const { session_id,board,url,query,discovered_at } = req.body
  res.json({ id: run('INSERT INTO discovery_log(session_id,board,url,query,discovered_at) VALUES(?,?,?,?,?)', [session_id,board,url,query,discovered_at]).lastInsertRowid })
})

// ── Cover letters ─────────────────────────────────────────
app.get('/api/cover-letters', (req, res) => {
  const { session_id } = req.query
  let q = 'SELECT * FROM cover_letters'; const params = []
  if (session_id) { q += ' WHERE session_id=?'; params.push(session_id) }
  res.json(queryAll(q + ' ORDER BY created_at DESC', params))
})
app.post('/api/cover-letters', (req, res) => {
  const { session_id,job_id,company,file_name,file_path,board,application_url } = req.body
  res.json({ id: run(`INSERT INTO cover_letters(session_id,job_id,company,file_name,file_path,board,application_url) VALUES(?,?,?,?,?,?,?)`, [session_id,job_id,company,file_name,file_path,board,application_url]).lastInsertRowid })
})

// ── Job submission tracking ───────────────────────────────
// Mark a job as submitted
app.patch('/api/jobs/:id/submit', (req, res) => {
  db.run("UPDATE jobs SET status='submitted' WHERE id=?", [req.params.id])
  saveDB(); res.json({ ok: true })
})

// Get ready-to-apply jobs for a session
app.get('/api/jobs/ready', (req, res) => {
  const { session_id } = req.query
  let q = "SELECT * FROM jobs WHERE (status='ready' OR status='filled') AND carryover=0"
  const params = []
  if (session_id) { q += ' AND session_id=?'; params.push(session_id) }
  q += ' ORDER BY score DESC'
  res.json(queryAll(q, params))
})

// Generate Claude session summary for clipboard
app.get('/api/session-summary/:session_id', async (req, res) => {
  const sid = req.params.session_id
  try {
    const session  = queryAll('SELECT * FROM sessions WHERE id=?', [sid])[0]
    const jobs     = queryAll("SELECT * FROM jobs WHERE session_id=? AND (status='ready' OR status='filled') ORDER BY score DESC", [sid])
    const resume   = queryAll('SELECT file_name, updated_at FROM stored_files WHERE type=?', ['resume'])[0]
    const clFile   = queryAll('SELECT file_name FROM stored_files WHERE type=?', ['cover_letter'])[0]
    const qaBank   = queryAll('SELECT qa_pairs.question, qa_pairs.answer, qa_categories.name as category FROM qa_pairs JOIN qa_categories ON qa_pairs.category_id=qa_categories.id ORDER BY qa_categories.sort_order')
    const clLetters = queryAll('SELECT * FROM cover_letters WHERE session_id=?', [sid])

    // Build Q&A grouped by category
    const qaByCategory = {}
    for (const pair of qaBank) {
      if (!qaByCategory[pair.category]) qaByCategory[pair.category] = []
      qaByCategory[pair.category].push({ q: pair.question, a: pair.answer })
    }

    const summary = {
      session_date: session?.date || new Date().toLocaleDateString('en-US'),
      resume_file: resume?.file_name || 'Not uploaded',
      cover_letter_template: clFile?.file_name || 'Not uploaded',
      ready_applications: jobs.map(j => ({
        title: j.title,
        company: j.company,
        url: j.url,
        score: j.score,
        cover_letter: clLetters.find(c => c.job_id === j.id)?.file_name || null
      })),
      qa_bank: qaByCategory,
      instructions: [
        'I have a job application agent that has filtered and approved the following applications.',
        'Please use Claude in Chrome to open each application URL in a dedicated Chrome window,',
        'fill out the forms using my resume info and Q&A answers below, and leave each tab open for my review.',
        'Do NOT submit any application — leave them all open for me to review and submit manually.',
        'If any question asks whether you are AI or human, leave it blank and note it.',
        'For multiple choice questions, pick the best option based on my Q&A answers.',
        'Background check / work authorization questions should be auto-answered based on Q&A bank.',
        'Non-background multiple choice with low confidence should be flagged for my review.'
      ].join(' ')
    }

    res.json(summary)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Stats ─────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const n = (sql) => queryAll(sql)[0]?.n ?? 0
  res.json({
    totalJobs:     n("SELECT COUNT(*) as n FROM jobs"),
    totalFilled:   n("SELECT COUNT(*) as n FROM jobs WHERE status='ready' OR status='filled' OR status='submitted'"),
    totalSubmitted: n("SELECT COUNT(*) as n FROM jobs WHERE status='submitted'"),
    totalSkipped:  n("SELECT COUNT(*) as n FROM jobs WHERE status='skip'"),
    totalCLs:      n("SELECT COUNT(*) as n FROM cover_letters"),
    totalSessions: n("SELECT COUNT(*) as n FROM sessions"),
    carryover:     n("SELECT COUNT(*) as n FROM jobs WHERE carryover=1"),
    totalQAPairs:  n("SELECT COUNT(*) as n FROM qa_pairs"),
    aiDetections:  n("SELECT COUNT(*) as n FROM qa_match_log WHERE is_ai_detection=1"),
    needsReview:   n("SELECT COUNT(*) as n FROM qa_match_log WHERE needs_review=1"),
  })
})

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ Job Agent server running at http://localhost:${PORT}`)
    console.log(`🤖 Claude API: ${process.env.ANTHROPIC_API_KEY ? 'key loaded' : '⚠️  no key found in .env'}`)
    console.log(`📦 Database: ${DB_PATH}\n`)
  })
}).catch(err => { console.error('Failed to init DB:', err); process.exit(1) })
