import re

replacement = """function Landing({ onSignIn, busy }) {
  return (
    <div className="landing" style={{
      position: 'relative', minHeight: '100vh',
      background: 'url(/bg-nodes.webp) center/cover no-repeat',
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      paddingRight: '10%', fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5, 10, 20, 0.65)', zIndex: 0 }}></div>
      <div style={{ position: 'relative', zIndex: 1, width: '450px', padding: '3.5rem', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(20px)', borderRadius: '24px', border: '1px solid rgba(255, 255, 255, 0.2)', boxShadow: '0 25px 50px rgba(0,0,0,0.8), inset 0 2px 10px rgba(255,255,255,0.1)', color: '#fff', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: '500', marginBottom: '2.5rem', textAlign: 'center', letterSpacing: '1px' }}>Welcome to the world of Blockchain</h2>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
            <input type="text" placeholder="First Name" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none' }} />
          </div>
          <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
            <input type="text" placeholder="Second Name" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none' }} />
          </div>
        </div>
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
          <input type="email" placeholder="Enter your email address here" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2.5rem' }}>
          <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
            <input type="password" placeholder="Password" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none' }} />
          </div>
          <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
            <input type="password" placeholder="Confirm Password" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none' }} />
          </div>
        </div>
        <button onClick={onSignIn} disabled={busy} style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', fontWeight: 'bold', background: 'linear-gradient(90deg, #e2e8f0 0%, #94a3b8 100%)', border: 'none', borderRadius: '12px', color: '#0f172a', cursor: 'pointer', boxShadow: '0 4px 15px rgba(255,255,255,0.1)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {busy ? 'Connecting...' : 'Sign In'}
        </button>
        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
          By signing in you agree to our terms & conditions
        </div>
        <div style={{ margin: '2rem 0', display: 'flex', alignItems: 'center', color: '#64748b', fontSize: '0.85rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.2)' }}></div>
          <span style={{ margin: '0 1rem' }}>OR</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.2)' }}></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
          <span style={{ fontSize: '1.5rem', cursor: 'pointer' }}>🌐</span>
          <span style={{ fontSize: '1.5rem', cursor: 'pointer' }}>🛡️</span>
          <span style={{ fontSize: '1.5rem', cursor: 'pointer' }}>🔒</span>
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.85rem', color: '#94a3b8' }}>
          Already have an account? <strong style={{ color: '#fff', cursor: 'pointer' }} onClick={onSignIn}>Sign in</strong>
        </div>
      </div>
    </div>
  );
}"""

with open('frontend/src/App.jsx', 'r', encoding='utf8') as f:
    c = f.read()
c = re.sub(r'function Landing.*?function Mark', replacement + '\n\nfunction Mark', c, flags=re.DOTALL)
with open('frontend/src/App.jsx', 'w', encoding='utf8') as f:
    f.write(c)

with open('frontend/src/styles.css', 'r', encoding='utf8') as f:
    s = f.read()
s = re.sub(r':root \{[\s\S]*?--font: system-ui, sans-serif;', """:root {
  --ink: #e2e8f0;
  --paper: #090e17;
  --surface: #101827;
  --line: #1e293b;
  --line-strong: #334155;
  --muted: #94a3b8;
  --teal: #06b6d4;
  --teal-soft: rgba(6,182,212,0.15);
  --blue: #3b82f6;
  --violet: #8b5cf6;
  --violet-soft: rgba(139,92,246,0.15);
  --amber: #f59e0b;
  --amber-soft: rgba(245,158,11,0.15);
  --red: #ef4444;
  --red-soft: rgba(239,68,68,0.15);
  --r-sm: 8px;
  --r-md: 16px;
  --font: system-ui, sans-serif;""", s)
with open('frontend/src/styles.css', 'w', encoding='utf8') as f:
    f.write(s)
