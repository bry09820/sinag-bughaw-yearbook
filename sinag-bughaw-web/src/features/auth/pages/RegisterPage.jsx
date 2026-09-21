import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '@/api/auth.api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import ConsentModal from '../components/ConsentModal';

// Must match backend User::DEPARTMENT_COURSES exactly
const SCHOOLS = [
  {
    key: 'SACE',
    label: 'SACE — School of Architecture, Computing & Engineering',
    courses: [
      'Bachelor of Science in Architecture',
      'Bachelor of Science in Civil Engineering',
      'Bachelor of Science in Computer Science',
      'Bachelor of Science in Information Technology',
      'Bachelor of Multimedia Arts',
    ],
  },
  {
    key: 'SAHS',
    label: 'SAHS — School of Allied Health Sciences',
    courses: [
      'Bachelor of Science in Nursing',
      'Bachelor of Science in Medical Technology',
      'Bachelor of Science in Psychology',
    ],
  },
  {
    key: 'SABM',
    label: 'SABM — School of Accountancy, Business & Management',
    courses: [
      'Bachelor of Science in Accountancy',
      'Bachelor of Science in Business Administration - Financial Management',
      'Bachelor of Science in Business Administration - Marketing Management',
      'Bachelor of Science in Tourism Management',
    ],
  },
  {
    key: 'SGS',
    label: 'SGS — School of Graduate Studies',
    courses: ['Master in Management'],
  },
  {
    key: 'SHS',
    label: 'SHS — Senior High School',
    courses: ['ABM', 'STEM', 'HUMSS'],
  },
];

const BATCH_YEARS = Array.from(
  { length: new Date().getFullYear() + 5 - 1990 + 1 },
  (_, i) => String(new Date().getFullYear() + 5 - i)
);

// Styles
const INPUT_CLS =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#1d2b4b] ' +
  'placeholder:text-slate-400 outline-none focus:border-[#3f51b5] focus:ring-4 ' +
  'focus:ring-[#3f51b5]/10 transition shadow-sm';
const ERROR_CLS   = '!border-red-400 focus:!border-red-400 focus:!ring-red-100';
const SUCCESS_CLS = '!border-emerald-400 focus:!border-emerald-400 focus:!ring-emerald-100';

function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setToken, fetchUser } = useAuth();

  // Steps: 'form' 'otp'
  const [step, setStep] = useState('form');

  const [form, setForm] = useState({
    first_name:            '',
    last_name:             '',
    student_id:            '',
    email:                 '',
    course:                '',
    graduation_year:       '',
    batch:                 '',
    password:              '',
    password_confirmation: '',
  });

  const [errors,      setErrors]      = useState({});
  const [loading,     setLoading]     = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Yearbook verify: idle | loading | found | not_found
  const [verifyState,     setVerifyState]     = useState('idle');
  const [verifiedStudent, setVerifiedStudent] = useState(null);

  // OTP
  const [otp,         setOtp]         = useState(['', '', '', '', '', '']);
  const [resendTimer, setResendTimer] = useState(0);
  const [showConsent, setShowConsent] = useState(false);
  const otpRefs = useRef([]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  // Derived intent from verify state
  // 'graduate' only when yearbook match found; else 'browse'
  const intent = verifyState === 'found' ? 'graduate' : 'browse';

  // Field change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'graduation_year' ? { batch: value } : {}),
    }));
    setErrors((prev) => ({ ...prev, [name]: '' }));

    if (['student_id', 'first_name', 'last_name'].includes(name)) {
      setVerifyState('idle');
      setVerifiedStudent(null);
    }
  };

  // Student look-up
  const runVerify = useCallback(async (current) => {
    const { student_id, first_name, last_name } = current;
    if (!student_id.trim() || !first_name.trim() || !last_name.trim()) return;

    setVerifyState('loading');
    try {
      const { data } = await authApi.verifyStudent({
        student_no: student_id,
        first_name,
        last_name,
      });

      if (data.found) {
        setVerifyState('found');
        setVerifiedStudent(data.student);
        // Pre-fill email, course, and batch from yearbook record if fields are still empty
        setForm((prev) => ({
          ...prev,
          email:           prev.email           || data.student.email || '',
          course:          prev.course          || data.student.course || '',
          graduation_year: prev.graduation_year || String(data.student.graduation_year || ''),
          batch:           prev.batch           || String(data.student.graduation_year || ''),
        }));
      } else {
        setVerifyState('not_found');
        setVerifiedStudent(null);
      }
    } catch {
      setVerifyState('idle');
    }
  }, []);

  const debouncedVerify = useDebounce(() => runVerify(form), 600);

  const handleIdentityBlur = () => debouncedVerify();

  // Register submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    const newErrors = {};
    if (!form.first_name.trim())  newErrors.first_name = 'First name is required.';
    if (!form.last_name.trim())   newErrors.last_name  = 'Last name is required.';
    if (!form.student_id.trim())  newErrors.student_id = 'Student ID is required.';
    if (!form.email.trim())       newErrors.email      = 'Email is required.';
    if (!form.course)             newErrors.course     = 'Please select a course.';
    if (!form.graduation_year)    newErrors.graduation_year = 'Please select your batch.';
    if (!form.password)           newErrors.password   = 'Password is required.';
    if (form.password.length < 8) newErrors.password   = 'At least 8 characters.';
    if (form.password !== form.password_confirmation)
      newErrors.password_confirmation = 'Passwords do not match.';

    if (verifyState === 'loading')
      newErrors.student_id = 'Please wait for verification to complete.';

    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const { data } = await authApi.register({
        ...form,
        intent,
        consent_accepted: true,
      });

      // No token until OTP is verified. Backend already emailed the code.
      if (data.email_send_failed) {
        setSubmitError(data.message || 'Account created, but the verification email failed. Please resend.');
      }
      setStep('otp');
      setResendTimer(60);
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.errors) {
        const mapped = {};
        Object.entries(errData.errors).forEach(([k, v]) => {
          mapped[k] = Array.isArray(v) ? v[0] : v;
        });
        setErrors(mapped);
      } else {
        setSubmitError(errData?.message ?? 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // OTP
  const handleOtpChange = (i, value) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[i] = value;
    setOtp(next);
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
    if (code.length < 6) { setSubmitError('Please enter all 6 digits.'); return; }
    setSubmitError('');
    setLoading(true);
    try {
      const { data } = await authApi.verifyOtp(form.email, code);
      const token = data.access_token || data.token;
      if (token) await setToken(token);
      else await fetchUser();
      setShowConsent(true);
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Invalid or expired OTP.');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      await authApi.sendOtp(form.email);
      setOtp(['', '', '', '', '', '']);
      setResendTimer(60);
      setSubmitError('');
      otpRefs.current[0]?.focus();
    } catch {
      setSubmitError('Failed to resend OTP. Please try again.');
    }
  };

  const handleGoogleSSO = () => {
    window.location.href = `${import.meta.env.VITE_APP_URL}/auth/google/redirect`;
  };

  const fieldCls = (name) => [INPUT_CLS, errors[name] ? ERROR_CLS : ''].join(' ');

  // Verify status badge
  const VerifyBadge = () => {
    const hasAll =
      form.student_id.trim() && form.first_name.trim() && form.last_name.trim();
    if (!hasAll) return null;

    if (verifyState === 'loading')
      return (
        <span className="flex items-center gap-1.5 text-xs text-[#3f51b5] mt-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-[#3f51b5] border-t-transparent animate-spin inline-block" />
          Checking yearbook records…
        </span>
      );

    if (verifyState === 'found')
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-600 mt-1.5">
          <i className="fas fa-graduation-cap" />
          Graduate profile found — your yearbook data has been pre-filled.
        </span>
      );

    if (verifyState === 'not_found')
      return (
        <span className="flex items-center gap-1.5 text-xs text-slate-400 mt-1.5">
          <i className="fas fa-eye" />
          No yearbook match — registering as a browse account.
        </span>
      );

    return null;
  };

  // Render
  return (
    <div className="min-h-screen flex font-sans">
      <style>{`
        @keyframes slideLeft  { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideRight { from{opacity:0;transform:translateX( 20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideUp    { from{opacity:0;transform:translateY( 14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shake      { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes float      { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
      `}</style>

      {showConsent && (
        <ConsentModal
          onAccepted={async () => {
            try { await fetchUser(); } catch (_) {}
            navigate('/dashboard', { replace: true });
          }}
        />
      )}

      {/* LEFT PANEL */}
      <div
        className="hidden lg:flex lg:w-[38%] flex-col justify-between p-12 animate-[slideLeft_0.6s_ease]"
        style={{
          background:
            "linear-gradient(160deg,rgba(29,43,75,0.93),rgba(63,81,181,0.87)),url('/images/nustud.jpg') center/cover no-repeat",
        }}
      >
        <Link to="/" className="no-underline flex items-center gap-3">
          <img src="/images/NU_logo.png" alt="NU Lipa" className="h-11 object-contain" />
          <div className="leading-tight">
            <p className="text-white font-black text-[13px] uppercase tracking-widest m-0">Sinag-Bughaw</p>
            <p className="text-[#fdb813] text-[9px] tracking-[2px] uppercase m-0 mt-0.5">Digital Yearbook</p>
          </div>
        </Link>

        <div>
          <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 mb-6 border border-white/15 animate-[float_4s_ease-in-out_infinite]">
            <i className="fas fa-user-graduate text-[#fdb813] text-4xl mb-5 block" />
            <h2 className="text-white text-[1.5rem] font-black mb-3 leading-tight tracking-tight">
              Join the Pioneer<br />Community.
            </h2>
            <p className="text-white/65 text-sm leading-relaxed m-0">
              Create your digital profile and become part of the official NU Lipa Sinag-Bughaw yearbook archive.
            </p>
          </div>

          {/* How it works */}
          <div className="rounded-2xl bg-white/8 border border-white/10 px-5 py-4 space-y-3">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest m-0">How it works</p>
            {[
              { icon: 'fa-id-card',        text: 'Enter your name & Student ID' },
              { icon: 'fa-search',         text: 'We check the yearbook records' },
              { icon: 'fa-graduation-cap', text: 'Matched? Your profile is auto-linked' },
              { icon: 'fa-eye',            text: "Not matched? You'll browse as a student" },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#fdb813]/20 flex items-center justify-center shrink-0">
                  <i className={`fas ${s.icon} text-[#fdb813] text-[10px]`} />
                </div>
                <p className="text-white/60 text-xs m-0">{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/35 text-xs">© {new Date().getFullYear()} National University Lipa · Sinag-Bughaw</p>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-full lg:w-[62%] flex flex-col bg-[#f8fafc] animate-[slideRight_0.6s_ease]">

        {/* Top bar */}
        <div className="px-8 sm:px-14 lg:px-16 pt-8 shrink-0">
          {step === 'form' ? (
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 text-slate-400 hover:text-[#1d2b4b] text-sm font-semibold no-underline transition-colors group w-fit"
            >
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center group-hover:bg-[#1d2b4b] group-hover:text-white transition-all">
                <i className="fas fa-arrow-left text-xs" />
              </div>
              Back to Home
            </Link>
          ) : (
            <button
              onClick={() => { setStep('form'); setSubmitError(''); setOtp(['', '', '', '', '', '']); }}
              className="inline-flex items-center gap-2.5 text-slate-400 hover:text-[#1d2b4b] text-sm font-semibold transition-colors group w-fit border-none bg-transparent cursor-pointer p-0"
            >
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center group-hover:bg-[#1d2b4b] group-hover:text-white transition-all">
                <i className="fas fa-arrow-left text-xs" />
              </div>
              Back
            </button>
          )}
        </div>

        {/* Scrollable area */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-8 sm:px-14 lg:px-16 py-8">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-7 lg:hidden self-start">
            <img src="/images/NU_logo.png" alt="NU Lipa" className="h-10 object-contain" />
            <div className="leading-tight">
              <p className="text-[#1d2b4b] font-black text-xs uppercase tracking-widest m-0">Sinag-Bughaw</p>
              <p className="text-[#fdb813] text-[9px] tracking-[2px] uppercase m-0 mt-0.5">Digital Yearbook</p>
            </div>
          </div>

          <div className="w-full max-w-[480px]">

            {/* REGISTRATION FORM */}
            {step === 'form' && (
              <div className="animate-[slideUp_0.35s_ease]">
                {/* Header */}
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-[#3f51b5] flex items-center justify-center text-xl mb-5 shadow-sm">
                  <i className="fas fa-user-plus" />
                </div>
                <h1 className="text-[1.85rem] font-black text-[#1d2b4b] mb-1 tracking-tight">Create Your Account</h1>
                <p className="text-slate-400 text-sm mb-6">
                  Fill in your details — we'll automatically detect if you're a graduate.
                </p>

                {/* Intent indicator pill */}
                {verifyState !== 'idle' && verifyState !== 'loading' && (
                  <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold mb-5 border
                    ${verifyState === 'found'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <i className={`fas ${verifyState === 'found' ? 'fa-graduation-cap text-emerald-600' : 'fa-eye text-slate-400'}`} />
                    {verifyState === 'found'
                      ? 'Registering as: Graduate Student'
                      : 'Registering as: Browse Account'}
                  </div>
                )}

                {submitError && <ErrorBanner message={submitError} />}

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>

                  {/* Identity section */}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                      Identity
                      <span className="ml-2 font-normal normal-case tracking-normal text-slate-300">
                        — used to detect your yearbook profile
                      </span>
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                          First Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          name="first_name" value={form.first_name}
                          onChange={handleChange} onBlur={handleIdentityBlur}
                          placeholder="Juan"
                          className={fieldCls('first_name')}
                        />
                        {errors.first_name && <p className="text-red-500 text-xs mt-1">{errors.first_name}</p>}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                          Last Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          name="last_name" value={form.last_name}
                          onChange={handleChange} onBlur={handleIdentityBlur}
                          placeholder="dela Cruz"
                          className={fieldCls('last_name')}
                        />
                        {errors.last_name && <p className="text-red-500 text-xs mt-1">{errors.last_name}</p>}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                        Student ID <span className="text-red-400">*</span>
                        <span className="ml-1.5 font-normal text-slate-400 text-[10px]">
                          your NU Lipa student number
                        </span>
                      </label>
                      <input
                        name="student_id" value={form.student_id}
                        onChange={handleChange} onBlur={handleIdentityBlur}
                        placeholder="e.g. 2021-00123"
                        className={[
                          fieldCls('student_id'),
                          verifyState === 'found' ? SUCCESS_CLS : '',
                        ].join(' ')}
                      />
                      {errors.student_id
                        ? <p className="text-red-500 text-xs mt-1">{errors.student_id}</p>
                        : <VerifyBadge />
                      }
                    </div>

                    {/* Matched yearbook card */}
                    {verifiedStudent && (
                      <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5">
                        {verifiedStudent.photo ? (
                          <img
                            src={verifiedStudent.photo}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover shrink-0 ring-2 ring-emerald-300"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 text-sm font-bold ring-2 ring-emerald-300">
                            {verifiedStudent.first_name?.[0]}{verifiedStudent.last_name?.[0]}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-emerald-800 text-xs font-semibold leading-tight truncate">
                            {verifiedStudent.first_name} {verifiedStudent.last_name}
                          </p>
                          <p className="text-emerald-600 text-[10px] leading-tight">
                            {verifiedStudent.student_no}
                            {verifiedStudent.course ? ` · ${verifiedStudent.course}` : ''}
                            {verifiedStudent.honors  ? ` · ${verifiedStudent.honors}`  : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                          Graduate
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Account section */}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Account Details</p>

                    <div>
                      <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                        Email address <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="email" name="email" value={form.email}
                        onChange={handleChange} placeholder="juan@nu-lipa.edu.ph"
                        className={fieldCls('email')}
                      />
                      {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                        Course / Program <span className="text-red-400">*</span>
                        {verifyState === 'found' && (
                          <span className="ml-1.5 font-normal text-emerald-500 text-[10px]">pre-filled from yearbook</span>
                        )}
                      </label>
                      <select
                        name="course" value={form.course} onChange={handleChange}
                        className={[fieldCls('course'), !form.course ? 'text-slate-400' : ''].join(' ')}
                      >
                        <option value="" disabled>Select your course…</option>
                        {SCHOOLS.map((school) => (
                          <optgroup key={school.key} label={school.label}>
                            {school.courses.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {errors.course && <p className="text-red-500 text-xs mt-1">{errors.course}</p>}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                        Batch <span className="text-red-400">*</span>
                        {verifyState === 'found' && (
                          <span className="ml-1.5 font-normal text-emerald-500 text-[10px]">pre-filled from yearbook</span>
                        )}
                      </label>
                      <select
                        name="graduation_year"
                        value={form.graduation_year}
                        onChange={handleChange}
                        className={[fieldCls('graduation_year'), !form.graduation_year ? 'text-slate-400' : ''].join(' ')}
                      >
                        <option value="" disabled>Select your batch year...</option>
                        {BATCH_YEARS.map((year) => (
                          <option key={year} value={year}>Batch {year}</option>
                        ))}
                      </select>
                      {errors.graduation_year && <p className="text-red-500 text-xs mt-1">{errors.graduation_year}</p>}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                        Password <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password" name="password" value={form.password}
                        onChange={handleChange} placeholder="At least 8 characters"
                        className={fieldCls('password')}
                      />
                      {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[#1d2b4b] mb-1 block">
                        Confirm password <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password" name="password_confirmation" value={form.password_confirmation}
                        onChange={handleChange} placeholder="Re-enter your password"
                        className={[
                          fieldCls('password_confirmation'),
                          form.password_confirmation && form.password === form.password_confirmation
                            ? SUCCESS_CLS : '',
                        ].join(' ')}
                      />
                      {errors.password_confirmation && (
                        <p className="text-red-500 text-xs mt-1">{errors.password_confirmation}</p>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || verifyState === 'loading'}
                    className="w-full bg-[#1d2b4b] hover:bg-[#162038] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-lg cursor-pointer border-none text-sm"
                  >
                    {loading
                      ? <><span>Creating Account…</span><Spinner /></>
                      : <><span>Create My Account</span><i className="fas fa-arrow-right text-xs" /></>
                    }
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-slate-400 text-xs">or sign up with</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>

                  <button
                    type="button" onClick={handleGoogleSSO}
                    className="w-full flex items-center justify-center gap-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold py-3 rounded-xl transition-colors shadow-sm cursor-pointer text-sm"
                  >
                    <GoogleIcon />
                    Sign up with Google
                  </button>

                  <p className="text-center text-sm text-slate-400">
                    Already a member?{' '}
                    <Link to="/login" className="text-[#3f51b5] font-bold no-underline hover:underline">Sign In</Link>
                  </p>
                </form>
              </div>
            )}

            {/* OTP STEP */}
            {step === 'otp' && (
              <div className="animate-[slideUp_0.35s_ease]">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl mb-5 shadow-sm">
                  <i className="fas fa-envelope-open-text" />
                </div>
                <h1 className="text-[1.85rem] font-black text-[#1d2b4b] mb-1 tracking-tight">Verify Your Email</h1>
                <p className="text-slate-400 text-sm mb-1">We sent a 6-digit code to:</p>
                <p className="text-[#3f51b5] font-bold text-sm mb-7">{form.email}</p>

                {submitError && <ErrorBanner message={submitError} />}

                <form onSubmit={handleVerifyOtp}>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 text-center">
                    Enter Verification Code
                  </label>

                  <div className="flex gap-2 justify-center mb-6" onPaste={handleOtpPaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => (otpRefs.current[i] = el)}
                        type="text" inputMode="numeric" maxLength={1} value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className={`w-12 h-12 text-center text-lg font-black bg-white border-2 rounded-xl outline-none transition-all shadow-sm
                          ${digit
                            ? 'border-[#3f51b5] bg-indigo-50 text-[#1d2b4b]'
                            : 'border-slate-200 text-slate-300'}
                          focus:border-[#3f51b5] focus:bg-indigo-50 focus:ring-4 focus:ring-[#3f51b5]/10`}
                      />
                    ))}
                  </div>

                  <button
                    type="submit" disabled={loading}
                    className="w-full bg-[#1d2b4b] hover:bg-[#162038] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-lg cursor-pointer border-none text-sm"
                  >
                    {loading
                      ? <><span>Verifying…</span><Spinner /></>
                      : <><span>Verify & Continue</span><i className="fas fa-check text-xs" /></>
                    }
                  </button>
                </form>

                <div className="text-center mt-5 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                  <p className="text-slate-400 text-xs mb-1.5">Didn't receive the code?</p>
                  {resendTimer > 0
                    ? <p className="text-slate-500 text-sm m-0">Resend in <span className="font-bold text-[#3f51b5]">{resendTimer}s</span></p>
                    : <button onClick={handleResend} className="text-[#3f51b5] font-bold text-sm hover:underline bg-transparent border-none cursor-pointer">Resend Code</button>
                  }
                </div>

                <p className="text-center text-xs text-slate-400 mt-3">
                  Wrong email?{' '}
                  <button
                    onClick={() => { setStep('form'); setSubmitError(''); setOtp(['', '', '', '', '', '']); }}
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

// Sub-components
function ErrorBanner({ message }) {
  return (
    <div className="flex items-center gap-3 bg-red-50 text-red-600 border-l-4 border-red-500 rounded-xl px-4 py-3 text-sm mb-5 animate-[shake_0.4s_ease]">
      <i className="fas fa-exclamation-circle shrink-0" /> {message}
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-[spin_0.7s_linear_infinite]" />
  );
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
