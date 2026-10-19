import { useEffect, useRef, useState } from 'react';
import { QRme } from 'this.gui';
import { CURTAIN_KEY, acceptsCode, curtainClosed, curtainOverride } from '../session/comingSoon.js';

// "On Development / Coming Soon…" in front of the whole app on the public sites. The app is NOT rendered while the curtain is
// closed (nothing behind it loads or asks the server anything). The QR is decoration. See session/comingSoon.js: a curtain,
// not security.
function readUnlocked() {
  try { return window.localStorage.getItem(CURTAIN_KEY) === '1'; } catch { return false; }
}
function remember(on) {
  try { on ? window.localStorage.setItem(CURTAIN_KEY, '1') : window.localStorage.removeItem(CURTAIN_KEY); } catch { /* no storage: asked again next time */ }
}

export default function ComingSoonGate({ children }) {
  const { hostname, search, origin } = window.location;
  const [unlocked, setUnlocked] = useState(() => (curtainOverride(search) === 'reset' ? false : readUnlocked()));
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef(null);
  const closed = curtainClosed({ hostname, search, unlocked });

  // `?curtain=reset`: forget that this browser was let in (once, on load) and drop the parameter, so entering the code
  // afterwards works like on any other visit.
  useEffect(() => {
    if (curtainOverride(search) !== 'reset') return;
    remember(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('curtain', 'on');
      window.history.replaceState(null, '', url.toString());
    } catch { /* the curtain just stays reset */ }
  }, []);
  useEffect(() => { if (closed) inputRef.current?.focus(); }, [closed]);

  if (!closed) return children;

  const submit = (event) => {
    event.preventDefault();
    if (acceptsCode(code)) { remember(true); setUnlocked(true); setWrong(false); return; }
    setWrong(true);
    setCode('');
    inputRef.current?.focus();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coming soon"
      data-testid="coming-soon"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: '#070b0d', color: '#e8f1ee', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      }}
    >
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', marginBottom: 28, opacity: 0.9, pointerEvents: 'none' }}>
          <QRme value={origin} size={168} variant="lg" hoverFlip={false} clickFlip={false} />
        </div>
        <div style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', opacity: 0.6, marginBottom: 10 }}>On Development</div>
        <h1 style={{ margin: '0 0 34px', fontSize: 34, fontWeight: 700, letterSpacing: '0.01em' }}>Coming Soon…</h1>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => { setCode(e.target.value); if (wrong) setWrong(false); }}
          inputMode="numeric"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={12}
          placeholder="code"
          aria-label="Access code"
          aria-invalid={wrong}
          data-testid="coming-soon-code"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '11px 14px', textAlign: 'center', fontSize: 18, letterSpacing: '0.3em',
            borderRadius: 10, border: `1px solid ${wrong ? '#e5646e' : 'rgba(232,241,238,0.28)'}`, background: 'transparent', color: 'inherit', outline: 'none',
          }}
        />
        <div aria-live="polite" style={{ minHeight: 22, marginTop: 10, fontSize: 13, color: '#e5646e' }}>{wrong ? 'Incorrect code' : ''}</div>
        <button
          type="submit"
          style={{ marginTop: 6, padding: '9px 26px', borderRadius: 10, border: '1px solid rgba(232,241,238,0.4)', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
        >
          Enter
        </button>
      </form>
    </div>
  );
}
