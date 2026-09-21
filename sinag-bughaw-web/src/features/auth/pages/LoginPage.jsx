import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth }             from '@/features/auth/hooks/useAuth';
import { authApi, consentApi } from '@/api/auth.api';
import ConsentModal             from '../components/ConsentModal';

const STATS = [
  // TODO before launch: replace these static stats with real API counts from the backend.
  { value: '12,500+', label: 'Graduates' },
  { value: '35+',     label: 'Programs'  },
  { value: '50k+',    label: 'Photos'    },
];

const maskEmail = (value) => {
  const [local, domain] = value.split('@');
  if (!local || !domain) return value;
  return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 4))}@${domain}`;
};

export default function LoginPage() {
  const { loginCredentials, setToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step,        setStep]     = useState('form');
  const [email,       setEmail]    = useState('');
  const [password,    setPassword] = useState('');
  const [otp,         setOtp]      = useState(['','','','','','']);
  const [error,       setError]    = useState(() => {
    const e = searchParams.get('error');
    if (e === 'sso_failed')          return 'Google sign-in failed. Please try again.';
    if (e === 'unauthorized_domain') return 'Please use a valid Google account.';
    return '';
  });
  const [loading,     setLoading]     = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [showConsent, setShowConsent] = useState(false);
  const otpRefs = useRef([]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      // Credentials only — token is issued after OTP verification.
      const data = await loginCredentials(email, password);
      if (data?.email_send_failed) {
        setError(data.message || 'We could not send the verification email. Please use Resend.');
      }
      setStep('otp'); setResendTimer(60);
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials. Please try again.');
    } finally { setLoading(false); }
  };

  const handleOtpChange = (i, value) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp]; next[i] = value; setOtp(next);
    if (value && i < 5) otpRefs.current[i + 1]?.focus();
  };
  const handleOtpKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };
  const handleOtpPaste = (e) => {
    const p = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (p.length === 6) { setOtp(p.split('')); otpRefs.current[5]?.focus(); }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Please enter all 6 digits.'); return; }
    setError(''); setLoading(true);
    try {
      const { data } = await authApi.verifyOtp(email, code);
      const token = data.access_token || data.token;
      if (!token) throw new Error('Missing access token');
      await setToken(token);
      const { data: consent } = await consentApi.status();
      if (!consent.accepted) setShowConsent(true);
      else navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired OTP.');
      setOtp(['','','','','','']); otpRefs.current[0]?.focus();
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      await authApi.sendOtp(email);
      setOtp(['','','','','','']); setResendTimer(60); setError('');
      otpRefs.current[0]?.focus();
    } catch { setError('Failed to resend OTP. Please try again.'); }
  };

  const handleGoogleSSO = () => {
    window.location.href = `${import.meta.env.VITE_APP_URL}/auth/google/redirect`;
  };

  return (
    <div className="min-h-screen flex font-sans">
      <style>{`
        @keyframes slideLeft { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideRight{ from{opacity:0;transform:translateX(20px)}  to{opacity:1;transform:translateX(0)} }
        @keyframes slideUp   { from{opacity:0;transform:translateY(14px)}  to{opacity:1;transform:translateY(0)} }
        @keyframes shake     { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes spin      { to{transform:rotate(360deg)} }
        @keyframes float     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
      `}</style>

      {showConsent && <ConsentModal onAccepted={() => navigate('/dashboard')} />}

      {/* LEFT PANEL */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 animate-[slideLeft_0.6s_ease]"
        style={{ background:"linear-gradient(160deg,rgba(29,43,75,0.93),rgba(63,81,181,0.87)),url('/images/NU-building.jpg') center/cover no-repeat" }}
      >
        <Link to="/" className="no-underline flex items-center gap-3">
          <img src="/images/NU_logo.png" alt="NU Lipa" className="h-11 object-contain" />
          <div className="leading-tight">
            <p className="text-white font-black text-[13px] uppercase tracking-widest m-0">Sinag-Bughaw</p>
            <p className="text-[#fdb813] text-[9px] tracking-[2px] uppercase m-0 mt-0.5">Digital Yearbook</p>
          </div>
        </Link>

        <div className="animate-[float_4s_ease-in-out_infinite]">
          <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 mb-6 border border-white/15">
            <i className="fas fa-book-open text-[#fdb813] text-4xl mb-5 block" aria-hidden="true" />
            <h2 className="text-white text-[1.6rem] font-black mb-3 leading-tight tracking-tight">
              Your Legacy,<br />Digitally Preserved.
            </h2>
            <p className="text-white/65 text-sm leading-relaxed m-0">
              Connect with fellow pioneers, explore memories, and celebrate your journey at National University Lipa.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {STATS.map(({ value, label }) => (
              <div key={label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center border border-white/10">
                <p className="text-[#fdb813] font-black text-xl m-0 leading-none">{value}</p>
                <p className="text-white/55 text-xs m-0 mt-1.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/35 text-xs">© {new Date().getFullYear()} National University Lipa · Sinag-Bughaw</p>
      </div>

      {/* RIGHT PANEL */}
      <div className="relative w-full lg:w-[55%] min-h-screen flex items-center justify-center bg-[#f8fafc] animate-[slideRight_0.6s_ease]">

        {/* Top bar */}
        <div className="absolute left-0 right-0 top-0 px-8 sm:px-14 lg:px-16 pt-8">
          {step === 'form' ? (
            <Link to="/" className="inline-flex items-center gap-2.5 text-slate-400 hover:text-[#1d2b4b] text-sm font-semibold no-underline transition-colors group w-fit">
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center group-hover:bg-[#1d2b4b] group-hover:text-white transition-all">
                <i className="fas fa-arrow-left text-xs" aria-hidden="true" />
              </div>
              Back to Home
            </Link>
          ) : (
            <button onClick={() => { setStep('form'); setError(''); setOtp(['','','','','','']); }}
              className="inline-flex items-center gap-2.5 text-slate-400 hover:text-[#1d2b4b] text-sm font-semibold transition-colors group w-fit border-none bg-transparent cursor-pointer p-0">
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center group-hover:bg-[#1d2b4b] group-hover:text-white transition-all">
                <i className="fas fa-arrow-left text-xs" aria-hidden="true" />
              </div>
              Back
            </button>
          )}
        </div>

        {/* Centered form area */}
        <div className="w-full flex flex-col items-center justify-center px-8 sm:px-14 lg:px-16 py-10">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden self-start">
            <img src="/images/NU_logo.png" alt="NU Lipa" className="h-10 object-contain" />
            <div className="leading-tight">
              <p className="text-[#1d2b4b] font-black text-xs uppercase tracking-widest m-0">Sinag-Bughaw</p>
              <p className="text-[#fdb813] text-[9px] tracking-[2px] uppercase m-0 mt-0.5">Digital Yearbook</p>
            </div>
          </div>

          <div className="w-full max-w-[400px]">

            {/* Login form */}
            {step === 'form' && (
              <div className="animate-[slideUp_0.35s_ease]">
                <div className="flex items-center gap-2 mb-5">
                  <img src="/images/NU_logo.png" alt="NU Lipa" className="h-7 w-7 object-contain" />
                  <span className="text-[11px] font-semibold text-slate-500">National University Lipa</span>
                </div>
                <h1 className="text-[1.85rem] font-black text-[#1d2b4b] mb-1 tracking-tight">Welcome Back</h1>
                <p className="text-slate-400 text-sm mb-6">Sign in to your Sinag-Bughaw account.</p>

                {error && <ErrorBanner message={error} />}

                {/* Email + Password form */}
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {/* Email */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
                    <div className="relative">
                      <i className="far fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-sm pointer-events-none" aria-hidden="true" />
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        required autoFocus placeholder="you@gmail.com"
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:border-[#3f51b5] focus:ring-4 focus:ring-[#3f51b5]/10 transition shadow-sm" />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
                    <div className="relative">
                      <i className="fas fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-sm pointer-events-none" aria-hidden="true" />
                      <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                        required placeholder="••••••••"
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:border-[#3f51b5] focus:ring-4 focus:ring-[#3f51b5]/10 transition shadow-sm" />
                    </div>
                    <div className="flex justify-end mt-1.5">
                      <Link to="/forgot-password" className="text-[#3f51b5] text-xs font-semibold no-underline hover:underline">
                        Forgot password?
                      </Link>
                    </div>
                  </div>

                  {/* Sign in button */}
                  <button type="submit" disabled={loading}
                    className="w-full bg-[#F5A623] hover:bg-[#f7b73d] disabled:opacity-60 text-[#1B2A4A] font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-lg cursor-pointer border-none text-sm">
                    {loading ? <><span>Sending OTP…</span><Spinner /></> : <><span>Sign In</span><i className="fas fa-arrow-right text-xs" aria-hidden="true" /></>}
                  </button>
                </form>

                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-slate-400 text-xs">or continue with</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Google SSO */}
                <button onClick={handleGoogleSSO}
                  className="w-full flex items-center justify-center gap-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold py-3 rounded-xl transition-colors shadow-sm cursor-pointer text-sm">
                  <GoogleIcon />
                  Continue with Google
                </button>

                <p className="text-center text-sm text-slate-400 mt-5">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-[#3f51b5] font-bold no-underline hover:underline">Register Now</Link>
                </p>

                {/* Security notice */}
                <div className="mt-5 flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <i className="fas fa-shield-alt text-amber-500 text-sm mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="text-amber-700 text-xs m-0 leading-relaxed">
                    This system is monitored. Unauthorized access attempts are logged and may be reported.
                  </p>
                </div>
              </div>
            )}

            {/* OTP */}
            {step === 'otp' && (
              <div className="animate-[slideUp_0.35s_ease]">

                {/* Icon + heading */}
                <div className="w-12 h-12 rounded-2xl bg-[#1B2A4A] text-[#F5A623] flex items-center justify-center text-xl mb-5 shadow-sm">
                  <i className="fas fa-envelope-open-text" aria-hidden="true" />
                </div>
                <h1 className="text-[1.85rem] font-black text-[#1d2b4b] mb-1 tracking-tight">Check Your Email</h1>
                <p className="text-slate-400 text-sm mb-1">We sent a 6-digit verification code to:</p>
                <p className="text-[#3f51b5] font-bold text-sm mb-6">{maskEmail(email)}</p>

                {error && <ErrorBanner message={error} />}

                <form onSubmit={handleVerifyOtp}>

                  {/* OTP label */}
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 text-center">
                    Enter Verification Code
                  </label>

                  {/* OTP boxes */}
                  <div className="flex gap-2 justify-center mb-6" onPaste={handleOtpPaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => (otpRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpChange(i, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(i, e)}
                        className={`w-12 h-12 text-center text-lg font-black bg-white border-2 rounded-xl outline-none transition-all shadow-sm
                          ${digit
                            ? 'border-amber-400 bg-indigo-50 text-[#1d2b4b]'
                            : 'border-slate-200 text-slate-300'
                          }
                          focus:border-amber-400 focus:bg-indigo-50 focus:ring-1 focus:ring-amber-400`}
                      />
                    ))}
                  </div>

                  {/* Verify button */}
                  <button type="submit" disabled={loading}
                    className="w-full bg-[#F5A623] hover:bg-[#f7b73d] disabled:opacity-60 text-[#1B2A4A] font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-lg cursor-pointer border-none text-sm">
                    {loading
                      ? <><span>Verifying…</span><Spinner /></>
                      : <><span>Verify & Sign In</span><i className="fas fa-check text-xs" aria-hidden="true" /></>}
                  </button>
                </form>

                {/* Resend row */}
                <div className="text-center mt-5 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                  <p className="text-slate-400 text-xs mb-1.5">Didn't receive the code?</p>
                  {resendTimer > 0
                    ? <p className="text-slate-500 text-sm m-0">
                        Resend available in <span className="font-bold text-[#3f51b5]">{resendTimer}s</span>
                      </p>
                    : <button onClick={handleResend}
                        className="text-[#3f51b5] font-bold text-sm hover:underline bg-transparent border-none cursor-pointer">
                        Resend Code
                      </button>
                  }
                </div>

                {/* Wrong email? */}
                <p className="text-center text-xs text-slate-400 mt-3">
                  Wrong email?{' '}
                  <button
                    onClick={() => { setStep('form'); setError(''); setOtp(['','','','','','']); }}
                    className="text-[#3f51b5] font-semibold hover:underline bg-transparent border-none cursor-pointer text-xs"
                  >
                    Go back
                  </button>
                </p>

              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="flex items-center gap-3 bg-red-50 text-red-600 border-l-4 border-red-500 rounded-xl px-4 py-3 text-sm mb-5 animate-[shake_0.4s_ease]">
      <i className="fas fa-exclamation-circle shrink-0" aria-hidden="true" /> {message}
    </div>
  );
}
function Spinner() {
  return <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-[spin_0.7s_linear_infinite]" />;
}
function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
