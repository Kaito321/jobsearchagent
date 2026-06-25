export function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '18px 20px',
      ...style
    }}>
      {children}
    </div>
  )
}

export function Badge({ type = 'neutral', children }) {
  const styles = {
    success:  { background: 'var(--green-bg)',  color: 'var(--green)'  },
    warning:  { background: 'var(--amber-bg)',  color: 'var(--amber)'  },
    danger:   { background: 'var(--red-bg)',    color: 'var(--red)'    },
    info:     { background: 'var(--blue-bg)',   color: 'var(--blue)'   },
    purple:   { background: 'var(--purple-bg)', color: 'var(--purple)' },
    neutral:  { background: 'var(--bg3)',       color: 'var(--text2)'  },
  }
  return (
    <span style={{
      ...styles[type],
      fontSize: 11,
      fontWeight: 500,
      padding: '2px 8px',
      borderRadius: 20,
      whiteSpace: 'nowrap',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }}>
      {children}
    </span>
  )
}

export function StatCard({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{
      background: 'var(--bg3)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '14px 16px',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 26, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{label}</div>
    </div>
  )
}

export function Spinner({ size = 16 }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      border: `${size > 20 ? 2 : 1.5}px solid var(--border2)`,
      borderTopColor: 'var(--purple)',
      borderRadius: '50%',
      animation: 'spin .7s linear infinite',
      verticalAlign: 'middle',
      flexShrink: 0
    }} />
  )
}

export function Button({ children, onClick, disabled, variant = 'primary', size = 'md', style }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    border: 'none', borderRadius: 'var(--radius)', cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font)', fontWeight: 500, transition: 'all .15s',
    opacity: disabled ? 0.45 : 1, ...style
  }
  const sizes = {
    sm: { fontSize: 12, padding: '6px 12px' },
    md: { fontSize: 13, padding: '9px 18px' },
    lg: { fontSize: 14, padding: '11px 22px' }
  }
  const variants = {
    primary: { background: 'var(--purple)', color: '#fff' },
    secondary: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' },
    danger: { background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid rgba(248,113,113,.2)' }
  }
  return (
    <button style={{ ...base, ...sizes[size], ...variants[variant] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

export function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
      {children}
    </div>
  )
}

export function FilterPill({ pass, label }) {
  if (pass === null || pass === undefined)
    return <Badge type="neutral">{label}: —</Badge>
  return <Badge type={pass ? 'success' : 'danger'}>{label}: {pass ? 'pass' : 'fail'}</Badge>
}

export function UploadZone({ label, fileName, subLabel, onFile, onClear, accept = '.pdf' }) {
  const id = 'upload-' + label.replace(/\s+/g, '-')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <label htmlFor={id} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 12px', border: `1px dashed ${fileName ? 'var(--green)' : 'var(--border2)'}`,
        borderRadius: onClear && fileName ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
        cursor: 'pointer', background: fileName ? 'var(--green-bg)' : 'var(--bg3)',
        transition: 'all .15s', textAlign: 'center'
      }}>
        <i className={`ti ${fileName ? 'ti-circle-check' : 'ti-upload'}`}
          style={{ fontSize: 20, color: fileName ? 'var(--green)' : 'var(--text3)' }} />
        <span style={{ fontSize: 12, color: fileName ? 'var(--green)' : 'var(--text2)', wordBreak: 'break-all' }}>
          {fileName || label}
        </span>
        {subLabel && (
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{subLabel}</span>
        )}
      </label>
      <input id={id} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
      {onClear && fileName && (
        <button onClick={e => { e.preventDefault(); onClear() }} style={{
          fontSize: 11, padding: '5px 10px', background: 'var(--red-bg)',
          color: 'var(--red)', border: '1px dashed rgba(248,113,113,.3)',
          borderTop: 'none', borderRadius: '0 0 var(--radius) var(--radius)',
          cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all .15s'
        }}>
          <i className="ti ti-trash" style={{ fontSize: 11 }} /> Remove & clear saved file
        </button>
      )}
    </div>
  )
}

// Inject keyframes once
if (!document.getElementById('agent-keyframes')) {
  const s = document.createElement('style')
  s.id = 'agent-keyframes'
  s.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
  document.head.appendChild(s)
}
