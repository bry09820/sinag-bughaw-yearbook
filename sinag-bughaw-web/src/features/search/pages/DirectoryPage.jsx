import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { studentsApi } from '@/api/student.api';
import { faceApi } from '@/api/gallery.api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import FaceSearchButton from '@/components/ui/FaceSearchButton';
import FilterTabStrip from '@/components/ui/FilterTabStrip';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';
import { imageUrl, avatarUrl } from '@/utils/imageUrl';
import { COURSE_FILTERS, getCourseShort } from '@/utils/courseShort';
import { useSubscriptionGuard } from '@/features/subscription/hooks/useSubscriptionGuard';
import { useAppConfig } from '@/features/platform/AppConfigProvider';

// Constants
const faceUserId = (match) => {
  const id = Number(match?.account_user_id ?? match?.user_id);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const studentUserId = (student) => {
  const id = Number(student?.id ?? student?.user_id ?? student?.account_user_id);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const usableFaceMatches = (matches = []) => {
  const normalized = matches
    .map(m => ({
      ...m,
      user_id: faceUserId(m),
      similarity: Number(m?.similarity ?? m?.confidence ?? 0),
      student_record_id: m?.student_record_id ?? m?.student_id ?? null,
    }))
    .filter(m => m.user_id);

  const validMatches = normalized.filter(m =>
    m.name || m.student_id || m.course || m.profile_picture
  );
  const source = validMatches.length ? validMatches : normalized;
  return Array.from(new Map(source.map(m => [m.user_id, m])).values());
};

const getInitials = (name = '') =>
  name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');

const isUsableStudentPhoto = (photo) => {
  if (!photo) return false;
  const src = String(photo).toLowerCase();
  return !['default', 'avatar', 'placeholder', 'cartoon'].some(token => src.includes(token));
};

// AutocompleteDropdown
function AutocompleteDropdown({ suggestions, onSelect, visible }) {
  if (!visible || !suggestions.length) return null;
  return (
    <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white rounded-2xl
                    shadow-[0_24px_60px_rgba(29,43,75,0.18)] border border-indigo-100/50 overflow-hidden">
      {suggestions.map((s, i) => (
        <button key={s.id} onMouseDown={() => onSelect(s)}
          className={`w-full flex items-center gap-3 px-5 py-3 text-left border-none bg-transparent
                      cursor-pointer hover:bg-slate-50 transition-colors
                      ${i < suggestions.length - 1 ? 'border-b border-slate-50' : ''}`}>
          <div className="w-9 h-9 rounded-xl bg-[#1d2b4b] text-[#fdb813] flex items-center justify-center
                          font-black text-sm overflow-hidden shrink-0">
            {s.profile_picture
              ? <img src={imageUrl(s.profile_picture)} alt={s.name}
                  className="w-full h-full object-cover"
                  onError={e => { e.currentTarget.src = avatarUrl(s.name); }} />
              : getInitials(s.name)
            }
          </div>
          <div className="flex-1 min-w-0">
            <span className="block font-bold text-sm text-[#1d2b4b] truncate">{s.name}</span>
            <span className="block text-xs text-slate-400">{s.student_id} · {s.course_short}</span>
          </div>
          <i className="fas fa-arrow-right text-xs text-slate-300 shrink-0" />
        </button>
      ))}
    </div>
  );
}

// FaceMatchBanner
function FaceMatchBanner({ matches, onClear }) {
  if (!matches.length) return null;
  return (
    <div className="mt-3 px-4 py-3 rounded-xl bg-[#fdb813]/12 border border-[#fdb813]/40
                    backdrop-blur-sm flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {/* Avatar stack */}
        <div className="flex">
          {matches.slice(0, 3).map((m, i) => (
            <img key={m.user_id}
              src={imageUrl(m.profile_picture) || avatarUrl(m.name)}
              alt={m.name}
              onError={e => { e.currentTarget.src = avatarUrl(m.name); }}
              className="w-7 h-7 rounded-lg border-2 border-[#fdb813] object-cover"
              style={{ marginLeft: i > 0 ? '-7px' : 0 }}
            />
          ))}
        </div>
        <span className="text-[#fdb813] text-xs font-bold">
          <i className="fas fa-camera mr-1" />
          {matches.length} face match{matches.length > 1 ? 'es' : ''} found
          {matches[0] && (
            <span className="text-white/70 font-normal ml-1.5">
              · Best: {matches[0].name} ({matches[0].similarity}%)
            </span>
          )}
        </span>
      </div>
      <button onClick={onClear}
        className="bg-transparent border border-[#fdb813]/40 hover:border-[#fdb813] text-[#fdb813]
                   text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-colors shrink-0">
        <i className="fas fa-times mr-1" /> Clear
      </button>
    </div>
  );
}

// StudentCard
function StudentCard({ student, index, isMatched, matchData, locked = false, onLockedPress }) {
  const [imgError, setImgError] = useState(false);
  const batchYear   = student.batch_year || new Date().getFullYear();
  const hasPhoto    = isUsableStudentPhoto(student.profile_picture ?? student.photo_url ?? student.photo) && !imgError;
  const photoSrc    = student.profile_picture ?? student.photo_url ?? student.photo;
  const rawCourse = String(student.course || '').trim();
  const hasCourse = rawCourse && rawCourse.toLowerCase() !== 'no program listed';
  const courseShort = hasCourse ? (student.course_short || getCourseShort(student.course)) : '';

  const cardClassName = `group bg-white rounded-3xl overflow-hidden shadow-sm no-underline block
                 hover:-translate-y-2 hover:shadow-xl transition-all duration-300`;
  const cardStyle = {
    animation:    `fadeInUp 0.42s ease ${index * 0.04}s forwards`,
    opacity:      0,
    border:       isMatched ? '2px solid #fdb813' : '2px solid transparent',
    boxShadow:    isMatched ? '0 8px 30px rgba(253,184,19,0.2)' : undefined,
  };

  const body = (
    <>
      {/* Photo area */}
      <div className="h-60 relative overflow-hidden bg-[#1d2b4b]">
        {hasPhoto ? (
          <img
            src={imageUrl(photoSrc)}
            alt={student.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#fdb813] text-6xl font-black tracking-[-2px]">
            {getInitials(student.name)}
          </div>
        )}

        {/* Batch badge */}
        <div className="absolute top-3 right-3 bg-[#1d2b4b]/80 backdrop-blur-sm text-white
                        text-[10px] font-black px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 z-10 shadow">
          <i className="fas fa-graduation-cap text-[#fdb813] text-[9px]" /> {batchYear}
        </div>

        {/* Face match badge */}
        {isMatched && matchData && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-[#fdb813] text-[#1d2b4b]
                          font-black text-[10px] px-2.5 py-1.5 rounded-xl">
            <i className="fas fa-camera text-[9px]" />
            {matchData?.similarity?.toFixed(0) ?? '—'}% match
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-[#1d2b4b]/70 backdrop-blur-sm flex items-center justify-center
                        opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
          <span className="bg-white text-[#1d2b4b] font-black text-sm px-5 py-2.5 rounded-xl flex items-center gap-2">
            <i className={`fas ${locked ? 'fa-lock' : 'fa-eye'}`} /> {locked ? 'Upgrade to View' : 'View Profile'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-4 text-center">
        <h4 className="text-sm font-black text-[#1d2b4b] mb-2 leading-tight capitalize">{student.name}</h4>
        {hasCourse && (
          <span className="inline-block bg-indigo-50 text-[#3f51b5] text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-xl">
            {courseShort}
          </span>
        )}
      </div>
    </>
  );

  if (locked) {
    return (
      <button type="button" onClick={onLockedPress} className={`${cardClassName} cursor-pointer w-full text-left border-0 p-0`} style={cardStyle}>
        {body}
      </button>
    );
  }

  return (
    <Link
      to={`/students/${student.user_id ?? student.id}`}
      className={cardClassName}
      style={cardStyle}
    >
      {body}
    </Link>
  );
}

// Main Page
export default function DirectoryPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOn } = useAppConfig();
  const { isSubscribed } = useSubscriptionGuard();
  const premiumEnabled = isOn('enable_premium_subscription');
  const profilesLocked = premiumEnabled && !isSubscribed;

  const [students, setStudents] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [query,    setQuery]    = useState(searchParams.get('q') || '');
  const [course,   setCourse]   = useState('All Programs');
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [lastPage, setLastPage] = useState(1);

  const [suggestions,    setSuggestions]    = useState([]);
  const [showSuggest,    setShowSuggest]    = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [faceSearching, setFaceSearching] = useState(false);
  const [faceMatches,   setFaceMatches]   = useState([]);
  const [matchedIds,    setMatchedIds]    = useState(new Set());

  const searchTimer  = useRef(null);
  const suggestTimer = useRef(null);

  const isFaceMode = faceMatches.length > 0;
  const currentUserId = Number(user?.id);
  const visibleStudents = Number.isFinite(currentUserId) && currentUserId > 0
    ? students.filter(student => studentUserId(student) !== currentUserId)
    : students;

  const promptUpgrade = () => navigate('/premium');

  // Fetch students
  const fetchStudents = useCallback(async (q = query, c = course, p = 1) => {
    setLoading(true);
    try {
      const params = { per_page: 20, page: p };
      if (q) params.q = q;
      if (c !== 'All Programs') params.course = c;
      const { data } = await studentsApi.search(params);
      setStudents(data.data ?? []);
      setTotal(data.meta?.total ?? (data.data ?? []).length);
      setLastPage(data.meta?.last_page ?? 1);
      setPage(p);
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSuggestions = useCallback(async (q) => {
    if (q.length < 2) { setSuggestions([]); return; }
    setSuggestLoading(true);
    try {
      const { data } = await studentsApi.suggest({ q });
      const hiddenId = Number(user?.id);
      setSuggestions((data.suggestions ?? []).filter(s => {
        const id = Number(s?.id ?? s?.user_id ?? s?.account_user_id);
        return !Number.isFinite(hiddenId) || hiddenId <= 0 || id !== hiddenId;
      }));
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchStudents(); }, []);

  // Handlers
  const clearFaceResults = () => { setFaceMatches([]); setMatchedIds(new Set()); };

  const handleSearch = (val) => {
    setQuery(val);
    clearFaceResults();
    clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => fetchSuggestions(val), 150);
    clearTimeout(searchTimer.current);
    searchTimer.current  = setTimeout(() => fetchStudents(val, course, 1), 380);
  };

  const handleSuggestSelect = (s) => {
    setQuery(s.name);
    setShowSuggest(false);
    setSuggestions([]);
    fetchStudents(s.name, course, 1);
  };

  const handleFilter = (value) => {
    setCourse(value);
    clearFaceResults();
    fetchStudents(query, value, 1);
  };

  const reset = () => {
    setQuery('');
    setCourse('All Programs');
    setSuggestions([]);
    clearFaceResults();
    fetchStudents('', 'All Programs', 1);
  };

  const handleFaceFile = async (file) => {
    setFaceSearching(true);
    clearFaceResults();
    setQuery('');
    try {
      const fd = new FormData();
      fd.append('face_image', file);
      const { data }  = await faceApi.search(fd);
      const matches   = usableFaceMatches(data.matches ?? []);
      if (!matches.length) {
        alert('No matching student found. Ensure the photo shows a clear face.');
        return;
      }
      setFaceMatches(matches);
      setMatchedIds(new Set(matches.map(m => m.user_id)));
      const topName = matches[0]?.name ?? '';
      if (topName) { fetchStudents(topName, 'All Programs', 1); setQuery(topName); }
    } catch (err) {
      alert(err?.response?.data?.message || 'Face search failed. Please try again.');
    } finally {
      setFaceSearching(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7fe] font-sans">
      <style>{`
        @keyframes fadeInUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulseRing { 0%{box-shadow:0 0 0 0 rgba(253,184,19,0.5)} 70%{box-shadow:0 0 0 10px rgba(253,184,19,0)} 100%{box-shadow:0 0 0 0 rgba(253,184,19,0)} }
      `}</style>

      <Navbar />

      {/* Hero / Search Header */}
      <header
        className="relative min-h-[140px] px-5 sm:px-[8%] py-8 text-center text-white rounded-b-[28px] shadow-lg overflow-hidden"
        style={{ background: "linear-gradient(135deg,rgba(29,43,75,0.95),rgba(63,81,181,0.88)), url('/images/NU-building.jpg') center/cover no-repeat" }}
      >
        {/* Dot pattern */}
        <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, #fdb813 1.5px, transparent 1.5px)', backgroundSize: '24px 24px' }} />

        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 bg-[#fdb813]/15 border border-[#fdb813]/30 text-[#fdb813]
                           text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3">
            <i className="fas fa-users text-[9px]" /> Student Directory
          </span>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
            Sinag-Bughaw <span className="text-[#fdb813]">Pioneers</span>
          </h1>
          <p className="text-white/70 text-sm max-w-md mx-auto mb-5 leading-relaxed font-light">
            Connecting the innovators of National University Lipa. Built by Pioneers, for Pioneers.
          </p>

          {/* Search box */}
          <div className="max-w-[600px] mx-auto">
            <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-2 border border-white/20 shadow-2xl">
              <div className="relative">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-[#fdb813] text-sm pointer-events-none z-[1]" />
                {suggestLoading && (
                  <i className="fas fa-spinner animate-spin absolute right-14 top-1/2 -translate-y-1/2 text-white/40 text-sm pointer-events-none z-[1]" />
                )}
                <input
                  type="text"
                  value={query}
                  onChange={e => handleSearch(e.target.value)}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 160)}
                  placeholder="Search names, student IDs, or programs…"
                  className={`w-full h-12 pl-11 pr-14 rounded-xl bg-white/8 text-white text-sm outline-none
                               placeholder-white/40 transition-all
                               ${isFaceMode ? 'border-[1.5px] border-[#fdb813]' : 'border-[1.5px] border-transparent'}`}
                  style={{ fontFamily: 'inherit' }}
                />
                <FaceSearchButton onFile={handleFaceFile} loading={faceSearching} />

                {/* Autocomplete */}
                <div className="absolute left-0 right-0 z-50">
                  <AutocompleteDropdown
                    suggestions={suggestions}
                    onSelect={handleSuggestSelect}
                    visible={showSuggest}
                  />
                </div>
              </div>
            </div>

            <FaceMatchBanner matches={faceMatches} onClear={() => { clearFaceResults(); setQuery(''); fetchStudents('', 'All Programs', 1); }} />
          </div>
        </div>
      </header>

      {/* Course filters */}
      <nav className="border-b border-slate-200 bg-white px-5 py-3 shadow-sm sm:px-[8%]" aria-label="Filter students by program">
        <div className="mx-auto max-w-[1180px]">
          <FilterTabStrip
            ariaLabel="Filter students by program"
            activeValue={course}
            onChange={handleFilter}
            tabs={COURSE_FILTERS}
          />
        </div>
      </nav>

      {/* Result count */}
      {!loading && !isFaceMode && (
        <p className="text-center text-xs text-slate-400 mt-3 mb-0 px-4">
          {query ? (
            <>
              Found <strong className="text-[#1d2b4b]">{total}</strong> result{total !== 1 ? 's' : ''} for "
              <strong className="text-[#3f51b5]">{query}</strong>"
            </>
          ) : (
            <>
              Showing <strong className="text-[#1d2b4b]">{total}</strong> student{total !== 1 ? 's' : ''}
              {course !== 'All Programs' && (
                <> in <strong className="text-[#3f51b5]">{COURSE_FILTERS.find(f => f.value === course)?.label}</strong></>
              )}
            </>
          )}
        </p>
      )}

      {/* Main content */}
      <main className="flex-1 px-4 sm:px-[8%] py-8">

        {profilesLocked && (
          <button
            type="button"
            onClick={promptUpgrade}
            className="mb-6 w-full flex items-center gap-4 rounded-2xl bg-[#263187] px-5 py-4 text-left border-0 cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <p className="m-0 text-white text-sm font-black">Unlock full directory profiles</p>
              <p className="m-0 mt-1 text-[#d8dff4] text-xs">
                Free accounts can browse and message classmates. Upgrade for full yearbook details.
              </p>
            </div>
            <span className="shrink-0 rounded-xl bg-[#fdb813] text-[#102044] text-xs font-black px-4 py-2.5">
              Upgrade
            </span>
          </button>
        )}

        {/* Loading */}
        {loading ? (
          <LoadingSkeleton variant="card" count={8} />

        ) : visibleStudents.length === 0 ? (
          /* Empty state */
          <div className="text-center py-24 bg-white rounded-3xl shadow-sm border border-slate-100 px-6">
            <i className="fas fa-user-slash text-7xl text-slate-100 mb-5 block" />
            <h3 className="text-xl font-black text-[#1d2b4b] mb-2">No Students Found</h3>
            <p className="text-slate-400 text-sm mb-7">
              {isFaceMode
                ? 'No student profiles matched the uploaded face.'
                : 'Try adjusting your search or filters.'}
            </p>
            <button onClick={reset}
              className="bg-[#1d2b4b] hover:bg-[#162038] text-white font-bold px-7 py-3 rounded-xl
                         border-none cursor-pointer inline-flex items-center gap-2 transition-colors">
              <i className="fas fa-redo" /> Reset Search
            </button>
          </div>

        ) : (
          <>
            {/* Student grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
              {visibleStudents.map((student, i) => (
                <StudentCard
                  key={student.id}
                  student={student}
                  index={i}
                  isMatched={matchedIds.has(studentUserId(student))}
                  matchData={faceMatches.find(m => m.user_id === studentUserId(student))}
                  locked={false}
                  onLockedPress={promptUpgrade}
                />
              ))}
            </div>

            {/* Pagination */}
            {lastPage > 1 && (
              <div className="flex items-center justify-center gap-3 mt-12">
                <button
                  onClick={() => fetchStudents(query, course, page - 1)}
                  disabled={page <= 1 || loading}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm bg-[#1d2b4b] hover:bg-[#162038] text-white
                             border-none cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                             flex items-center gap-1.5">
                  <i className="fas fa-chevron-left text-xs" /> Prev
                </button>
                <span className="px-5 py-2.5 rounded-xl text-sm font-bold bg-white text-[#1d2b4b] shadow-sm border border-slate-100">
                  {page} / {lastPage}
                </span>
                <button
                  onClick={() => fetchStudents(query, course, page + 1)}
                  disabled={page >= lastPage || loading}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm bg-[#1d2b4b] hover:bg-[#162038] text-white
                             border-none cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                             flex items-center gap-1.5">
                  Next <i className="fas fa-chevron-right text-xs" />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
