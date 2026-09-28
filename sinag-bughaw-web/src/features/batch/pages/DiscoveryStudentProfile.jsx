import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { COURSE_LABELS } from '@/api/batch.api';
import { imageUrl } from '@/utils/imageUrl';
import { recordProfileView } from '@/api/analytics.api';
import { trackProfileView } from '@/utils/ga4';
import api from '@/services/api';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { hasPaidAccess } from '@/utils/subscription';
import { useChatHeads } from '@/features/messaging/context/ChatHeadsContext';

const discoveryStudentApi = {
  show: (id) => api.get(`/discover/students/${id}`),
};

function getInitials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');
}

function safeArray(val) {
  if (!val) return [];
  const values = Array.isArray(val) ? val : (() => {
    try { return JSON.parse(val); } catch { return []; }
  })();
  return values.filter(isMeaningfulValue);
}

function isMeaningfulValue(value) {
  const text = String(value ?? '').trim();
  return text !== '' && text !== '-' && text !== '—' && text !== 'â€”';
}

function formatDate(str) {
  if (!str) return null;
  return new Date(str).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Sub-components

function Section({ icon, label, children }) {
  return (
    <div className="border border-[#d8c7a2]/45 bg-white/75 p-5 shadow-[0_14px_34px_rgba(7,26,51,0.06)]">
      <h4 className="flex items-center gap-2 text-[10px] font-black text-[#071a33] uppercase tracking-[0.22em] m-0 mb-4">
        <i className={`${icon} text-[#c89b3c] text-[10px]`} />
        {label}
      </h4>
      {children}
    </div>
  );
}

function InfoTile({ icon, label, value }) {
  if (!value) return null;
  return (
    <div className="bg-[#fbf7ef] border border-[#d8c7a2]/35 p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <i className={`fas ${icon} text-[#c89b3c] text-[9px]`} />
        <span className="text-[10px] text-[#8f7d55] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-semibold text-[#071a33] m-0 break-words">{value}</p>
    </div>
  );
}

function QuoteBlock({ icon, label, text, borderColor = 'border-amber-200' }) {
  if (!text) return null;
  return (
    <div className="pb-4 mb-4 border-b border-slate-100 last:border-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <i className={`fas ${icon} text-[#fdb813] text-[10px]`} />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">{label}</p>
      </div>
      <p className={`text-sm text-[#172033]/75 italic m-0 leading-relaxed pl-3 border-l-2 ${borderColor}`}>
        "{text}"
      </p>
    </div>
  );
}

function PillBadge({ text, variant = 'indigo' }) {
  const styles = {
    indigo: 'text-[10px] font-bold text-[#3f51b5] bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full tracking-wide inline-flex items-center gap-1',
    amber:  'text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full tracking-wide inline-flex items-center gap-1',
    green:  'text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full tracking-wide inline-flex items-center gap-1',
  };
  return <span className={styles[variant] ?? styles.indigo}>{text}</span>;
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center text-center py-8">
      <div className="w-12 h-12 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center mb-3">
        <i className={`fas ${icon} text-slate-300 text-lg`} />
      </div>
      <p className="text-sm font-bold text-[#1d2b4b] mb-0.5">{title}</p>
      {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#f4f7fe] px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <LoadingSkeleton variant="page" count={1} />
      </div>
    </div>
  );
}

// Tab definitions
const TABS = [
  { key: 'profile',  label: 'Profile',  icon: 'fas fa-user'               },
  { key: 'academic', label: 'Academic', icon: 'fas fa-graduation-cap'     },
  { key: 'yearbook', label: 'Yearbook', icon: 'fas fa-book-open'          },
  { key: 'messages', label: 'Messages', icon: 'fas fa-envelope-open-text' },
];

// Main Page
export default function DiscoveryStudentProfile() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { openChat } = useChatHeads();

  const [student,   setStudent]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [imgError,  setImgError]  = useState(false);
  const [error,     setError]     = useState(null);
  const [toast,     setToast]     = useState(null);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    setLoading(true);
    setError(null);
    setImgError(false);
    discoveryStudentApi.show(id)
      .then(({ data }) => {
        const studentData = data.data ?? data;
        setStudent(studentData);

        // Record view using users.id (not students.id)
        if (studentData.user_id) {
          recordProfileView(studentData.user_id);
          trackProfileView({
            id:     studentData.user_id,
            name:   `${studentData.first_name} ${studentData.last_name}`.trim(),
            course: studentData.course ?? '',
            batch:  studentData.graduation_year ?? '',
          });
        }
      })
      .catch(() => setError('Student not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) return <PageSkeleton />;

  if (error || !student) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f7fe] gap-3 px-4 text-center">
      <i className="fas fa-user-slash text-5xl text-slate-200" />
      <h2 className="text-lg font-black text-[#1d2b4b] m-0">Student Not Found</h2>
      <p className="text-sm text-slate-400 m-0">{error ?? 'This student profile does not exist.'}</p>
      <button
        onClick={() => navigate('/discover')}
        className="bg-transparent border-none text-[#3f51b5] text-sm font-semibold cursor-pointer"
      >
        ← Back to Discovery
      </button>
    </div>
  );

  // Derived values
  const firstName   = student.first_name  ?? '';
  const lastName    = student.last_name   ?? '';
  const displayName = `${firstName} ${lastName}`.trim();
  const fullName    = student.middle_name
    ? `${firstName} ${student.middle_name} ${lastName}`.trim()
    : displayName;

  const photoSrc      = student.photo_url ?? student.photo ?? null;
  const shortCourse   = COURSE_LABELS[student.course] ?? student.course ?? 'Student';
  const canViewFull   = student.is_premium_viewer === true
    || student.is_subscribed_viewer === true
    || hasPaidAccess(authUser);
  const honors        = safeArray(student.honors);
  const organizations = safeArray(student.organizations);
  const achievements  = safeArray(student.achievements);
  const batchYear     = student.graduation_year ?? new Date().getFullYear();

  const hasSocials = student.facebook_url || student.instagram_url
                  || student.linkedin_url  || student.github_url;

  const hasYearbookContent = student.motto        || student.student_quote
    || student.fondest_memory || student.ambition || student.future_plans
    || student.most_likely_to;

  const hasMessages = student.message_to_batchmates || student.message_to_parents;
  const messageTargetId = student.user_id ?? null;
  const canMessage = Boolean(
    authUser?.id
    && messageTargetId
    && String(messageTargetId) !== String(authUser.id)
  );
  const messageTarget = canMessage
    ? {
        id: messageTargetId,
        user_id: messageTargetId,
        name: displayName,
        profile_picture: photoSrc,
        course: student.course,
      }
    : null;

  const avatarFallback = (
    <div className="w-full h-full flex items-center justify-center text-3xl font-black text-[#fdb813]">
      {getInitials(displayName)}
    </div>
  );

  // Tab content
  const tabContent = {

    profile: (
      <div className="flex flex-col gap-3">
        <Section icon="fas fa-id-card" label="Basic Information">
          <div className="grid grid-cols-2 gap-3">
            <InfoTile icon="fa-hashtag"        label="Student No."  value={student.student_no} />
            <InfoTile icon="fa-user"           label="Full Name"    value={fullName} />
            <InfoTile icon="fa-cake-candles"   label="Birthday"     value={formatDate(student.birthday)} />
            <InfoTile icon="fa-map-pin"        label="Hometown"     value={student.hometown} />
            <InfoTile icon="fa-book"           label="Program"      value={shortCourse} />
            <InfoTile icon="fa-graduation-cap" label="Batch Year"   value={student.graduation_year ? String(student.graduation_year) : null} />
            <InfoTile icon="fa-layer-group"    label="Section"      value={student.section?.name ? `Section ${student.section.name}` : null} />
          </div>
        </Section>

        {hasSocials && (
          <Section icon="fas fa-share-nodes" label="Social Links">
            <div className="flex flex-wrap gap-2">
              {[
                { url: student.facebook_url,  icon: 'fa-facebook',  label: 'Facebook',  color: '#1877F2' },
                { url: student.instagram_url, icon: 'fa-instagram', label: 'Instagram', color: '#E1306C' },
                { url: student.linkedin_url,  icon: 'fa-linkedin',  label: 'LinkedIn',  color: '#0A66C2' },
                { url: student.github_url,    icon: 'fa-github',    label: 'GitHub',    color: '#1d2b4b' },
              ].filter(s => s.url).map(s => (
                <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200
                             bg-slate-50 hover:bg-white hover:shadow-sm text-sm font-semibold
                             no-underline text-[#1d2b4b] transition">
                  <i className={`fab ${s.icon} text-base`} style={{ color: s.color }} />
                  {s.label}
                </a>
              ))}
            </div>
          </Section>
        )}
      </div>
    ),

    academic: (
      <div className="flex flex-col gap-3">
        <Section icon="fas fa-medal" label="Honors & Awards">
          {honors.length === 0 ? (
            <EmptyState icon="fa-medal" title="No Honors Yet" subtitle="This student hasn't added any honors yet." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {honors.map((h, i) => (
                <span key={i}
                  className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">
                  <i className="fas fa-star text-[#fdb813] text-[9px]" />
                  <span className="text-xs font-semibold text-amber-800">{h}</span>
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section icon="fas fa-people-group" label="Organizations">
          {organizations.length === 0 ? (
            <EmptyState icon="fa-people-group" title="No Organizations" subtitle="This student hasn't added any organizations yet." />
          ) : (
            <ul className="m-0 p-0 list-none space-y-2">
              {organizations.map((o, i) => (
                <li key={i}
                  className="flex items-start gap-2 text-sm text-slate-600 font-medium py-2 border-b border-slate-100 last:border-0">
                  <i className="fas fa-circle text-[5px] text-[#fdb813] mt-[7px] shrink-0" />
                  {o}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon="fas fa-trophy" label="Achievements">
          {achievements.length === 0 ? (
            <EmptyState icon="fa-award" title="No Achievements Yet" subtitle="This student hasn't added any achievements yet." />
          ) : (
            achievements.map((a, i, arr) => (
              <div key={i}
                className={`flex items-center gap-4 py-4 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                  <i className="fas fa-award text-[#fdb813] text-base" />
                </div>
                <p className="text-sm font-bold text-[#1d2b4b] m-0 flex-1">{a}</p>
                <i className="fas fa-chevron-right text-slate-200 text-xs" />
              </div>
            ))
          )}
        </Section>
      </div>
    ),

    yearbook: (
      <div className="flex flex-col gap-3">
        <Section icon="fas fa-book-open" label="Yearbook">
          {student.graduation_year && (
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl
                            px-4 py-3 flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <i className="fas fa-graduation-cap text-emerald-600 text-sm" />
              </div>
              <div>
                <p className="text-sm font-black text-emerald-800 m-0">
                  {honors[0] ? `${honors[0]} Graduate` : 'Graduate'} · Class of {batchYear}
                </p>
                <p className="text-xs text-emerald-600 m-0 mt-0.5">
                  {shortCourse} · National University Lipa
                </p>
              </div>
            </div>
          )}

          {hasYearbookContent ? (
            <>
              <QuoteBlock icon="fa-quote-left"   label="Personal Motto"  text={student.motto}          borderColor="border-amber-200"   />
              <QuoteBlock icon="fa-comment-dots" label="Student Quote"   text={student.student_quote}  borderColor="border-indigo-200"  />
              <QuoteBlock icon="fa-rocket"       label="Ambition"        text={student.ambition}       borderColor="border-amber-200"   />
              <QuoteBlock icon="fa-map"          label="Future Plans"    text={student.future_plans}   borderColor="border-indigo-200"  />
              <QuoteBlock icon="fa-heart"        label="Fondest Memory"  text={student.fondest_memory} borderColor="border-rose-200"    />
              <QuoteBlock icon="fa-trophy"       label="Most Likely To"  text={student.most_likely_to} borderColor="border-emerald-200" />
            </>
          ) : (
            <EmptyState icon="fa-book-open" title="No Yearbook Content" subtitle="This student hasn't added yearbook content yet." />
          )}
        </Section>
      </div>
    ),

    messages: (
      <div className="flex flex-col gap-3">
        <Section icon="fas fa-envelope-open-text" label="Messages">
          {hasMessages ? (
            <>
              <QuoteBlock
                icon="fa-users"
                label="To My Batchmates"
                text={student.message_to_batchmates}
                borderColor="border-indigo-200"
              />
              <QuoteBlock
                icon="fa-house-heart"
                label="To My Parents"
                text={student.message_to_parents}
                borderColor="border-rose-200"
              />
            </>
          ) : (
            <EmptyState icon="fa-envelope" title="No Messages" subtitle="This student hasn't added any messages yet." />
          )}
        </Section>
      </div>
    ),
  };

  return (
    <div className="min-h-screen bg-[#F0F2F7] flex flex-col font-sans text-[#071a33]">
      <Navbar />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-20 left-1/2 z-[9000] -translate-x-1/2 animate-[fadeIn_0.2s_ease] px-5 py-2.5 rounded-xl text-sm font-semibold shadow-xl
                       whitespace-nowrap flex items-center gap-2
                       ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-[#1d2b4b] text-white'}`}
        >
          <i className={`fas ${toast.type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check'} text-[#fdb813]`} />
          {toast.msg}
        </div>
      )}

      <main className="flex-1 max-w-[980px] mx-auto w-full px-4 sm:px-6 py-8 flex flex-col gap-3 animate-[fadeIn_0.25s_ease]">
        {/* PROFILE CARD */}
        <div className="bg-white overflow-hidden shadow-[0_24px_60px_rgba(7,26,51,0.12)] border border-[#d8c7a2]/50">

          {/* Cover */}
          <div className="h-32 sm:h-44 relative overflow-hidden bg-[#071a33]">
            <img src="/images/NU-building.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#031225]/95 via-[#071a33]/86 to-[#071a33]/68" />
            <div className="absolute inset-5 border border-[#c89b3c]/45" />
            <div className="absolute inset-8 border border-white/10" />

            <button
              onClick={() => navigate('/discover')}
              className="absolute top-4 left-5 flex items-center gap-1.5 text-white/80 hover:text-white
                         bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-1.5
                         cursor-pointer text-xs font-semibold transition"
            >
              <i className="fas fa-arrow-left text-[10px]" /> Back
            </button>

            <div className="hidden">
              <span className="text-[10px] font-bold text-white bg-white/10 backdrop-blur-sm
                               border border-white/15 rounded-md px-2 py-0.5 uppercase tracking-widest">
                NU Lipa
              </span>
              <span className="text-white/40 text-xs">·</span>
              <span className="text-[10px] font-bold text-white bg-white/10 backdrop-blur-sm
                               border border-white/15 rounded-md px-2 py-0.5">
                {shortCourse}
              </span>
              {student.graduation_year && (
                <>
                  <span className="text-white/40 text-xs">·</span>
                  <span className="text-[10px] font-bold text-[#fdb813] bg-[#fdb813]/10 backdrop-blur-sm
                                   border border-[#fdb813]/20 rounded-md px-2 py-0.5">
                    Batch '{String(student.graduation_year).slice(-2)}
                  </span>
                </>
              )}
            </div>
            <div className="absolute bottom-3 left-5 flex flex-wrap items-center gap-1.5">
              {[
                { key: 'school', text: 'NU Lipa', className: 'text-white bg-white/10 border-white/15 uppercase tracking-widest' },
                isMeaningfulValue(shortCourse) && {
                  key: 'course',
                  text: shortCourse,
                  className: 'text-white bg-white/10 border-white/15',
                },
                student.graduation_year && {
                  key: 'batch',
                  text: `Batch '${String(student.graduation_year).slice(-2)}`,
                  className: 'text-[#fdb813] bg-[#fdb813]/10 border-[#fdb813]/20',
                },
              ].filter(Boolean).map((item, index) => (
                <span key={item.key} className="inline-flex items-center gap-1.5">
                  {index > 0 && <span className="text-white/40 text-xs">·</span>}
                  <span className={`text-[10px] font-bold backdrop-blur-sm border rounded-md px-2 py-0.5 ${item.className}`}>
                    {item.text}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="px-5 sm:px-8 pb-6">
            <div className="flex items-end justify-between mb-4 -mt-12 sm:-mt-14">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="p-[3px] rounded-full bg-gradient-to-br from-[#fdb813] to-amber-500 inline-block">
                  <div className="p-[3px] rounded-full bg-white inline-block">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-[#1d2b4b]">
                      {photoSrc && !imgError ? (
                        <img
                          src={imageUrl(photoSrc)}
                          alt={displayName}
                          className="w-full h-full object-cover block"
                          onError={() => setImgError(true)}
                        />
                      ) : avatarFallback}
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
              </div>

              {/* Actions — messaging available to all registered students */}
              <div className="flex items-center gap-2 pt-14 sm:pt-16">
                {canMessage && (
                  <button
                    type="button"
                    onClick={() => openChat(messageTarget)}
                    className="inline-flex items-center gap-2 rounded-xl border-none bg-[#1d2b4b] px-4 py-2.5
                               text-xs font-black text-white cursor-pointer transition hover:bg-[#162038]"
                  >
                    <i className="fas fa-paper-plane text-[#fdb813]" /> Message
                  </button>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.href);
                    showToast('Link copied!');
                  }}
                  className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50
                             text-slate-500 cursor-pointer flex items-center justify-center transition text-sm"
                >
                  <i className="fas fa-share-alt" />
                </button>
              </div>
            </div>

            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="font-serif text-3xl font-black text-[#071a33] m-0 leading-none">{displayName}</h1>
              {student.graduation_year ? (
                <PillBadge
                  text={<><i className="fas fa-graduation-cap text-[8px]" /> GRADUATE {batchYear}</>}
                  variant="green"
                />
              ) : (
                <PillBadge text={`PIONEER ${batchYear}`} variant="indigo" />
              )}
            </div>

            {student.nickname && (
              <p className="text-sm text-slate-400 font-medium mb-1">"{student.nickname}"</p>
            )}
            <p className="text-sm text-slate-500 font-medium mb-4">
              {shortCourse} · National University Lipa
            </p>

            {/* Stats row */}
            <div className="flex gap-5 flex-wrap mb-4 pb-4 border-b border-slate-100">
              {[
                { value: shortCourse,                          label: 'Program' },
                { value: batchYear,                            label: 'Batch'   },
                { value: student.section?.name ?? 'N/A',      label: 'Section' },
                { value: student.student_no   ?? 'N/A',       label: 'ID'      },
                { value: honors.length > 0 ? honors[0] : '—', label: 'Honors'  },
              ].filter(s => isMeaningfulValue(s.value)).map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-sm font-black text-[#1d2b4b] m-0 leading-tight break-words max-w-[120px]">{s.value}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-1 m-0">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Motto */}
            {canViewFull && student.motto ? (
              <p className="text-sm text-[#172033]/70 leading-relaxed italic m-0 mb-3 pl-3 border-l-[3px] border-[#c89b3c]">
                "{student.motto}"
              </p>
            ) : !canViewFull ? null : (
              <p className="text-sm text-slate-300 italic m-0 mb-3 pl-3 border-l-[3px] border-slate-200">
                No motto added yet.
              </p>
            )}

            {/* Hometown + socials */}
            <div className="flex gap-4 mt-3 flex-wrap items-center">
              {student.hometown && (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <i className="fas fa-map-marker-alt text-red-400 text-[10px]" /> {student.hometown}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <i className="fas fa-university text-[#3f51b5] text-[10px]" /> NU Lipa
              </span>

              {canViewFull && hasSocials && (
                <div className="flex items-center gap-2 ml-auto">
                  {student.facebook_url && (
                    <a href={student.facebook_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#1877F2] text-sm hover:opacity-75 transition">
                      <i className="fab fa-facebook" />
                    </a>
                  )}
                  {student.instagram_url && (
                    <a href={student.instagram_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#E1306C] text-sm hover:opacity-75 transition">
                      <i className="fab fa-instagram" />
                    </a>
                  )}
                  {student.linkedin_url && (
                    <a href={student.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#0A66C2] text-sm hover:opacity-75 transition">
                      <i className="fab fa-linkedin" />
                    </a>
                  )}
                  {student.github_url && (
                    <a href={student.github_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#1d2b4b] text-sm hover:opacity-75 transition">
                      <i className="fab fa-github" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TABS */}
        {canViewFull ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex border-b border-slate-100 overflow-x-auto scrollbar-none">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  flex items-center gap-2 px-5 py-3.5 text-xs font-bold uppercase tracking-wider
                  whitespace-nowrap cursor-pointer border-none bg-transparent transition-all shrink-0
                  ${activeTab === tab.key
                    ? 'text-[#1d2b4b] border-b-2 border-[#fdb813] -mb-px'
                    : 'text-slate-400 hover:text-slate-600'
                  }
                `}
              >
                <i className={`${tab.icon} text-[11px] ${activeTab === tab.key ? 'text-[#fdb813]' : ''}`} />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4 animate-[fadeIn_0.2s_ease]" key={activeTab}>
            {tabContent[activeTab]}
          </div>
        </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 sm:p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                <i className="fas fa-lock text-lg" />
              </div>
              <p className="m-0 mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-amber-600">
                Full Discovery Locked
              </p>
              <h2 className="m-0 text-xl font-black text-[#1d2b4b]">Upgrade to view full profile</h2>
              <p className="mx-auto mt-3 mb-0 max-w-sm text-sm leading-relaxed text-slate-500">
                Premium unlocks academic details, yearbook dedications, mottos, memories, and contact links.
                Direct messaging stays available on free accounts.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                {canMessage && (
                  <button
                    type="button"
                    onClick={() => openChat(messageTarget)}
                    className="rounded-xl border-none bg-[#1d2b4b] px-5 py-3 text-sm font-black text-white cursor-pointer transition hover:bg-[#162038]"
                  >
                    <i className="fas fa-paper-plane text-[#fdb813] mr-2" /> Message
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/premium')}
                  className="rounded-xl border-none bg-[#fdb813] px-5 py-3 text-sm font-black text-[#1d2b4b] cursor-pointer transition hover:bg-amber-300"
                >
                  Upgrade Now
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/discover')}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-500 cursor-pointer transition hover:bg-slate-50"
                >
                  Back to Discovery
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
      <Footer />
    </div>
  );
}
