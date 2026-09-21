import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SubscriptionGate({
  isSubscribed,
  children,
  preview,
  message = 'Subscribe to view full student information and posts.',
  variant = 'card', // 'card' | 'inline' | 'full'
}) {
  const navigate = useNavigate();
  const [hov, setHov] = useState(false);

  if (isSubscribed) return children;

  const minH = variant === 'full' ? 260 : variant === 'inline' ? 80 : 140;

  const defaultPreview = (
    <div style={{ minHeight: minH, background: '#f1f5f9', borderRadius: 12, padding: 20 }}>
      {[80, 55, 70, 40].map((w, i) => (
        <div key={i} style={{ height: 11, width: `${w}%`, background: '#e2e8f0', borderRadius: 6, marginBottom: 10 }} />
      ))}
    </div>
  );

  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', isolation: 'isolate' }}>
      {/* Blurred preview */}
      <div style={{ filter: 'blur(6px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.45 }}>
        {preview || defaultPreview}
      </div>

      {/* Lock overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(150deg, rgba(29,43,75,0.88) 0%, rgba(63,81,181,0.78) 100%)',
        backdropFilter: 'blur(1px)',
        gap: 12, padding: 24,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'rgba(253,184,19,0.15)',
          border: '1.5px solid rgba(253,184,19,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fdb813', fontSize: 20,
          boxShadow: '0 0 24px rgba(253,184,19,0.2)',
        }}>
          <i className="fas fa-lock" />
        </div>

        <p style={{
          color: '#fff', fontSize: 13, fontWeight: 600,
          textAlign: 'center', lineHeight: 1.6,
          maxWidth: 240, margin: 0,
          textShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }}>
          {message}
        </p>

        <button
          onClick={() => navigate('/premium')}
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
          style={{
            padding: '9px 24px',
            background: 'linear-gradient(135deg, #fdb813, #f59e0b)',
            color: '#1d2b4b', border: 'none', borderRadius: 10,
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
            letterSpacing: '0.04em',
            boxShadow: hov ? '0 6px 20px rgba(253,184,19,0.5)' : '0 3px 12px rgba(253,184,19,0.28)',
            transform: hov ? 'translateY(-2px)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          Upgrade to Premium
        </button>
      </div>
    </div>
  );
}