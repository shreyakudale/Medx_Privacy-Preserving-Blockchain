import re

replacement = """function Landing({ onSignIn, busy }) {
  return (
    <div className="landing" style={{
      position: 'relative', minHeight: '100vh',
      background: 'url(/bg-nodes.webp) center/cover no-repeat',
      display: 'flex', alignItems: 'stretch',
      fontFamily: 'system-ui, sans-serif'
    }}>
      {/* Dark Overlay for better contrast */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5, 10, 20, 0.7)', zIndex: 0 }}></div>
      
      {/* Left Side: Glowing Bitcoin Graphic & Branding */}
      <div style={{ flex: 1, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="float-3d" style={{
          width: '350px', height: '350px',
          background: 'url(https://cryptologos.cc/logos/bitcoin-btc-logo.png) center/contain no-repeat',
          filter: 'drop-shadow(0 0 50px rgba(251, 191, 36, 0.8))'
        }}></div>
      </div>

      {/* Right Side: Transparent Slide Card Sign In GUI */}
      <div style={{ flex: 1, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ 
          width: '100%', maxWidth: '500px', padding: '3.5rem', 
          background: 'rgba(15, 23, 42, 0.35)',
          backdropFilter: 'blur(25px)',
          WebkitBackdropFilter: 'blur(25px)',
          borderRadius: '24px', 
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.8), inset 0 1px 10px rgba(255,255,255,0.1)',
          color: '#fff', display: 'flex', flexDirection: 'column'
        }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: '500', marginBottom: '2.5rem', textAlign: 'center', letterSpacing: '1px', color: '#fbbf24' }}>Welcome to the world of Blockchain</h2>
          
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
              <input type="text" placeholder="First Name" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none', fontSize: '0.9rem' }} />
            </div>
            <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
              <input type="text" placeholder="Second Name" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none', fontSize: '0.9rem' }} />
            </div>
          </div>

          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
            <input type="email" placeholder="Enter your email address here" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none', fontSize: '0.9rem' }} />
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2.5rem' }}>
            <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
              <input type="password" placeholder="Password" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none', fontSize: '0.9rem' }} />
            </div>
            <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.5rem' }}>
              <input type="password" placeholder="Confirm Password" disabled style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none', fontSize: '0.9rem' }} />
            </div>
          </div>

          <button onClick={onSignIn} disabled={busy} style={{ 
            width: '100%', padding: '1rem', fontSize: '1.1rem', fontWeight: 'bold',
            background: 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)',
            border: 'none', borderRadius: '12px', color: '#0f172a', cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(245,158,11,0.3)', textTransform: 'uppercase', letterSpacing: '1px'
          }}>
            {busy ? 'Connecting...' : 'Sign Up'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: '#cbd5e1' }}>
            By signing up you agree to our terms & conditions
          </div>

          <div style={{ margin: '2rem 0', display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.2)' }}></div>
            <span style={{ margin: '0 1rem' }}>OR</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.2)' }}></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
            {/* Google */}
            <div style={{ width: '40px', height: '40px', background: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
               <img src="https://cdn-icons-png.flaticon.com/512/2991/2991148.png" alt="Google" style={{ width: '20px' }} />
            </div>
            {/* Microsoft */}
            <div style={{ width: '40px', height: '40px', background: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
               <img src="https://cdn-icons-png.flaticon.com/512/732/732221.png" alt="Microsoft" style={{ width: '20px' }} />
            </div>
            {/* Apple */}
            <div style={{ width: '40px', height: '40px', background: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
               <img src="https://cdn-icons-png.flaticon.com/512/0/747.png" alt="Apple" style={{ width: '20px' }} />
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: '0.85rem', color: '#cbd5e1' }}>
            Already have an account? <strong style={{ color: '#fbbf24', cursor: 'pointer' }} onClick={onSignIn}>Sign in</strong>
          </div>
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
