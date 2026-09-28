import { useEffect, useState } from 'react';
import { paymentsApi } from '@/api/payment.api';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { useAuth } from '@/features/auth/hooks/useAuth';

const TIERS = {
  standard: {
    label:    'Standard',
    color:    '#3f51b5',
    bg:       '#eef2ff',
    icon:     'fa-bolt',
    features: [
      'Browse all student profiles',
      'Access digital gallery',
      'Basic yearbook viewing',
      'Yearbook PDF download',
      'Section & faculty directory',
    ],
    plans: {
      standard_monthly: { label: 'Monthly', price: '₱99',   period: '/month', savings: null,       amount: 9900  },
      standard_yearly:  { label: 'Yearly',  price: '₱799',  period: '/year',  savings: 'Save 33%', amount: 79900 },
    },
  },
  premium: {
    label:    'Premium',
    color:    '#fdb813',
    bg:       '#fffbeb',
    icon:     'fa-crown',
    features: [
      'Everything in Standard',
      'Priority yearbook PDF downloads',
      'Priority AI face search',
      'Extended cloud storage',
      'Exclusive premium badge',
      'Early access to new features',
    ],
    plans: {
      premium_monthly: { label: 'Monthly', price: '₱199',   period: '/month', savings: null,       amount: 19900  },
      premium_yearly:  { label: 'Yearly',  price: '₱1,499', period: '/year',  savings: 'Save 37%', amount: 149900 },
    },
  },
};

export default function PaymentPage() {
  const { fetchUser } = useAuth();
  const [activeTier, setTier] = useState('standard');
  const [plan,       setPlan] = useState('standard_monthly');
  const [status,  setStatus]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying,  setPaying]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    paymentsApi.subscriptionStatus()
      .then(async ({ data }) => {
        setStatus(data);
        if (data?.is_premium) {
          setTier('premium');
          setPlan('premium_monthly');
        } else if (data?.is_standard) {
          setTier('standard');
          setPlan('standard_monthly');
        }
        try { await fetchUser(); } catch { /* keep payment status even if /me fails */ }
      })
      .finally(()      => setLoading(false));
  }, [fetchUser]);

  // When tier changes, auto-select the monthly plan for that tier
  const handleTierChange = (tier) => {
    setTier(tier);
    setPlan(tier === 'standard' ? 'standard_monthly' : 'premium_monthly');
  };

  const handleSubscribe = async () => {
    setPaying(true);
    setError('');
    try {
      // Prefer /api/billing/checkout; fall back to create-intent
      let data;
      try {
        ({ data } = await paymentsApi.checkout(plan));
      } catch {
        ({ data } = await paymentsApi.createIntent(plan));
      }
      if (data.checkout_url) {
        if (data.session_id) {
          localStorage.setItem('pending_paymongo_session_id', data.session_id);
        }
        window.location.href = data.checkout_url;
        return;
      }
      setError('Checkout URL was not returned. Please try again.');
    } catch (err) {
      setError(err.response?.data?.message || 'Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const tier        = TIERS[activeTier];
  const isAlreadyOn = activeTier === 'premium'
    ? status?.is_premium
    : status?.is_standard && !status?.is_premium
      ? true
      : false;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <Navbar />

      {/* Hero */}
      <header className="text-white text-center"
        style={{ background: 'linear-gradient(135deg, #1d2b4b 0%, #2a3d66 100%)', padding: '80px 8% 120px', borderRadius: '0 0 60px 60px' }}>
        <div className="inline-flex items-center gap-2 font-bold text-xs px-4 py-2 rounded-full mb-5"
          style={{ background: 'rgba(253,184,19,0.15)', color: '#fdb813', border: '1px solid rgba(253,184,19,0.3)' }}>
          <i className="fas fa-star" /> SINAG-BUGHAW PLANS
        </div>
        <h1 className="font-extrabold mb-4" style={{ fontSize: '3rem', letterSpacing: '-2px' }}>
          Choose Your <span style={{ color: '#fdb813' }}>Access Level</span>
        </h1>
        <p className="font-light mx-auto opacity-80" style={{ fontSize: '1rem', maxWidth: '550px' }}>
          Start with Standard for core features, or go Premium for the full Sinag-Bughaw experience.
        </p>
      </header>

      <main style={{ flex: 1, maxWidth: '1050px', margin: '0 auto', padding: '60px 20px 100px', width: '100%' }}>

        {/* Active subscription banner */}
        {!loading && (status?.is_premium || status?.is_standard) && (
          <div className="text-center mb-8 font-bold"
            style={{
              background: status.is_premium
                ? 'linear-gradient(135deg, #fdb813, #f59e0b)'
                : 'linear-gradient(135deg, #3f51b5, #5c6bc0)',
              color: status.is_premium ? '#1d2b4b' : 'white',
              padding: '20px', borderRadius: '20px',
            }}>
            <i className={`fas ${status.is_premium ? 'fa-crown' : 'fa-bolt'} text-xl mr-2`} />
            {status.is_premium ? 'Premium' : 'Standard'} Active · Expires&nbsp;
            {new Date(status.expires_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        )}

        {/* Tier toggle */}
        <div className="flex justify-center mb-10">
          <div className="flex gap-2 p-1.5 rounded-2xl" style={{ background: '#e2e8f0' }}>
            {Object.entries(TIERS).map(([key, t]) => (
              <button key={key} onClick={() => handleTierChange(key)}
                className="font-extrabold text-sm px-6 py-2.5 rounded-xl border-none cursor-pointer transition-all"
                style={{
                  background: activeTier === key ? 'white' : 'transparent',
                  color:      activeTier === key ? t.color : '#64748b',
                  boxShadow:  activeTier === key ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
                }}>
                <i className={`fas ${t.icon} mr-2`} />{t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '40px', alignItems: 'start' }}>

          {/* Left: Features */}
          <div>
            <h2 className="font-extrabold text-xl mb-6" style={{ color: '#1d2b4b' }}>
              {tier.label} Features
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tier.features.map(f => (
                <div key={f} className="flex items-center gap-4 bg-white"
                  style={{ padding: '16px 20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.02)' }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: tier.bg, color: tier.color }}>
                    <i className={`fas ${tier.icon} text-sm`} />
                  </div>
                  <p className="text-sm font-semibold m-0" style={{ color: '#1d2b4b' }}>{f}</p>
                  <i className="fas fa-check ml-auto text-sm" style={{ color: '#22c55e' }} />
                </div>
              ))}
            </div>

            {/* Upgrade nudge for standard viewers */}
            {activeTier === 'standard' && (
              <button onClick={() => handleTierChange('premium')}
                className="w-full mt-6 font-bold text-sm border-none cursor-pointer"
                style={{ background: 'none', color: '#fdb813', textDecoration: 'underline' }}>
                <i className="fas fa-crown mr-1" /> See what Premium adds →
              </button>
            )}
          </div>

          {/* Right: Plan selector */}
          <div className="bg-white" style={{ borderRadius: '28px', padding: '35px', boxShadow: '0 20px 40px rgba(29,43,75,0.1)' }}>
            <h2 className="font-extrabold text-xl mb-6" style={{ color: '#1d2b4b' }}>Choose a Plan</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '28px' }}>
              {Object.entries(tier.plans).map(([key, p]) => (
                <button key={key} onClick={() => setPlan(key)}
                  className="text-left border-none cursor-pointer transition-all"
                  style={{
                    padding: '20px 24px', borderRadius: '18px',
                    border:     `2px solid ${plan === key ? tier.color : '#e2e8f0'}`,
                    background: plan === key ? tier.bg : 'white',
                    transform:  plan === key ? 'scale(1.02)' : 'none',
                  }}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-base" style={{ color: '#1d2b4b' }}>{p.label}</span>
                        {isAlreadyOn && (
                          <span className="rounded-full border border-[#fdb813]/60 bg-[#fdb813]/15 px-2 py-1 text-[10px] font-black text-[#1d2b4b]">
                            Current plan
                          </span>
                        )}
                      </div>
                      <div className="text-sm mt-1" style={{ color: '#64748b' }}>
                        <span className="font-black text-2xl" style={{ color: plan === key ? tier.color : '#1d2b4b' }}>{p.price}</span>
                        {p.period}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {p.savings && (
                        <span className="font-bold text-xs px-2 py-1 rounded-full"
                          style={{ background: '#dcfce7', color: '#16a34a' }}>{p.savings}</span>
                      )}
                      <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                        style={{ borderColor: plan === key ? tier.color : '#e2e8f0', background: plan === key ? tier.color : 'white' }}>
                        {plan === key && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {error && (
              <div className="text-sm mb-4 p-3 rounded-xl flex items-center gap-2"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                <i className="fas fa-exclamation-circle" /> {error}
              </div>
            )}

            <button
              onClick={handleSubscribe}
              disabled={paying || isAlreadyOn}
              className="w-full font-extrabold border-none cursor-pointer transition-all flex items-center justify-center gap-3"
              style={{
                padding: '18px', borderRadius: '16px', fontSize: '1rem',
                background: isAlreadyOn ? '#94a3b8' : tier.color === '#fdb813' ? '#1d2b4b' : tier.color,
                color:      isAlreadyOn ? 'white'   : tier.color === '#fdb813' ? 'white'   : 'white',
                boxShadow:  '0 10px 25px rgba(29,43,75,0.2)',
                cursor:     isAlreadyOn ? 'not-allowed' : 'pointer',
              }}>
              {isAlreadyOn
                ? <><i className="fas fa-check-circle" /> Already on {tier.label}</>
                : paying
                  ? <><i className="fas fa-spinner fa-spin" /> Processing...</>
                  : <><i className={`fas ${tier.icon}`} style={{ color: tier.color === '#1d2b4b' ? '#fdb813' : 'white' }} /> Subscribe to {tier.label}</>}
            </button>

            {/* Upgrade from standard to premium */}
            {activeTier === 'standard' && status?.is_premium && (
              <p className="text-center text-xs mt-3" style={{ color: '#22c55e' }}>
                <i className="fas fa-crown mr-1" /> You already have Premium — all Standard features included.
              </p>
            )}

            <div className="flex items-center justify-center gap-4 mt-5">
              {['GCash', 'Maya', 'Visa/MC'].map(m => (
                <span key={m} className="text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={{ background: '#f1f5f9', color: '#64748b' }}>{m}</span>
              ))}
            </div>
            <p className="text-center text-xs mt-3" style={{ color: '#94a3b8' }}>
              <i className="fas fa-shield-alt mr-1" style={{ color: '#3f51b5' }} />
              Secure payments via PayMongo
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
