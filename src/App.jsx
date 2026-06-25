import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Settings from './pages/Settings'
import './App.css'

export default function App() {
  const [page, setPage] = useState('dashboard')

  return (
    <div className="layout">
      <nav className="nav">
        <div className="nav-brand">
          <i className="ti ti-briefcase" />
          <span>Job Agent</span>
        </div>
        <div className="nav-links">
          <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>
            <i className="ti ti-layout-dashboard" /> Dashboard
          </button>
          <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>
            <i className="ti ti-history" /> History
          </button>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
            <i className="ti ti-settings" /> Settings
          </button>
        </div>
      </nav>
      <main className="page-content">
        {page === 'dashboard' && <Dashboard />}
        {page === 'history'   && <History />}
        {page === 'settings'  && <Settings />}
      </main>
    </div>
  )
}
