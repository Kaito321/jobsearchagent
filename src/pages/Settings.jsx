import { useState, useEffect } from 'react'
import { Card, Button, SectionLabel } from '../components/UI'
import * as api from '../api'

export default function Settings() {
  const [saved, setSaved] = useState(false)
  const [dbPath] = useState('jobagent.db (project root)')

  function showSaved() { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <div>
      <h1 style={{ fontSize:20, fontWeight:600, marginBottom:6 }}>Settings</h1>
      <p style={{ color:'var(--text2)', fontSize:13, marginBottom:28 }}>Agent configuration and data management.</p>

      <div style={{ display:'flex', flexDirection:'column', gap:20, maxWidth:600 }}>

        <Card>
          <SectionLabel>Database</SectionLabel>
          <div style={{ fontSize:13, color:'var(--text2)', marginBottom:14 }}>
            Your data is stored permanently in a local SQLite database file. All sessions, jobs, and cover letter logs persist here.
          </div>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'10px 14px', fontFamily:'var(--mono)', fontSize:12, color:'var(--text2)' }}>
            📦 {dbPath}
          </div>
          <div style={{ marginTop:14, display:'flex', gap:10 }}>
            <Button size="sm" variant="secondary" onClick={() => {
              if (confirm('Export all data as JSON? This will open a download.')) {
                Promise.all([api.getSessions(), api.getJobs({}), api.getCoverLetters({}), api.getDiscoveryLog({})]).then(([s,j,c,l]) => {
                  const blob = new Blob([JSON.stringify({ sessions:s, jobs:j, coverLetters:c, discoveryLog:l }, null, 2)], { type:'application/json' })
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                  a.download = `jobagent-export-${new Date().toISOString().slice(0,10)}.json`; a.click()
                })
              }
            }}>
              <i className="ti ti-download" /> Export as JSON
            </Button>
          </div>
        </Card>

        <Card>
          <SectionLabel>How it works</SectionLabel>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[
              { icon:'ti-file', title:'Resume & cover letter', desc:'Upload PDFs in the Dashboard sidebar. Your resume is parsed by Claude AI for matching and auto-fill. Your cover letter template is customized per application.' },
              { icon:'ti-filter', title:'Four filters', desc:'Every job passes through: match score (≥70%), legitimacy check, posting age (≤30 days), and recent layoff scan. All four must pass to proceed.' },
              { icon:'ti-brand-chrome', title:'Claude in Chrome required', desc:'Browser automation (opening the dedicated Chrome window, tab management, form-filling) requires the Claude in Chrome extension to be installed and active.' },
              { icon:'ti-file-text', title:'Cover letter naming', desc:'Generated files follow the format: CompanyName_MMDDYY_CL.pdf or AAA_MMDDYY_CL.pdf (acronyms in caps). Saved to your chosen folder.' },
              { icon:'ti-clock', title:'Daily cap & carry-over', desc:'Set your daily cap (5–10) in the sidebar. Jobs that exceed the cap are held in carry-over and processed first in your next session.' },
              { icon:'ti-database', title:'Permanent storage', desc:'All data — sessions, jobs, logs, cover letter records — is stored in jobagent.db using SQLite. It persists across restarts and browser clears.' },
            ].map(item => (
              <div key={item.title} style={{ display:'flex', gap:14, padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                <i className={`ti ${item.icon}`} style={{ fontSize:18, color:'var(--purple)', marginTop:1, flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13, fontWeight:500, marginBottom:3 }}>{item.title}</div>
                  <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionLabel>Danger zone</SectionLabel>
          <div style={{ fontSize:13, color:'var(--text2)', marginBottom:14 }}>
            These actions are irreversible. Your database file will be cleared.
          </div>
          <Button size="sm" variant="danger" onClick={() => {
            if (confirm('This will clear all sessions, jobs, and logs from your database. Are you sure?')) {
              alert('To clear the database, delete jobagent.db from your project folder and restart the server.')
            }
          }}>
            <i className="ti ti-trash" /> Clear all data
          </Button>
        </Card>

      </div>
    </div>
  )
}
