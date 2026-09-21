import { useParams, Link } from 'react-router-dom';
import { useSection } from '@/features/batch/hooks/useBatch';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

// Helper: resolve storage URLs from env
const storageUrl = (path) =>
  path ? `${import.meta.env.VITE_API_URL}/storage/${path}` : null;

// Build display name from Student model fields (first_name + last_name)
const fullName = (s) =>
  `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'Unknown';

// Initials from first + last name
function getInitials(s) {
  const f = s.first_name?.[0]?.toUpperCase() ?? '';
  const l = s.last_name?.[0]?.toUpperCase()  ?? '';
  return f + l || '?';
}

function VisibilityBadge({ visibility }) {
  const map = {
    public:           { label: 'Public',      bg: '#ecfdf5', color: '#059669' },
    connections_only: { label: 'Connections', bg: '#fef3c7', color: '#d97706' },
    private:          { label: 'Private',     bg: '#fee2e2', color: '#dc2626' },
  };
  const style = map[visibility] ?? map.public;
  return (
    <span className="inline-block text-xs font-bold px-2 py-1 rounded-lg mt-2"
      style={{ background: style.bg, color: style.color }}>
      {style.label}
    </span>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl"
      style={{
        backdropFilter: 'blur(5px)',
        background:     'rgba(255,255,255,0.55)',
        border:         '1.5px dashed #cbd5e1',
      }}>
      <i className="fas fa-lock text-xl" style={{ color: '#94a3b8' }} />
      <span className="text-xs font-bold" style={{ color: '#94a3b8' }}>Premium Only</span>
    </div>
  );
}

export default function SectionDetailPage() {
  const { id }   = useParams();
  const {
    section, students, loading,
    error, isPremium, counts,
  } = useSection(id);

  // useSection may return students as a Laravel paginator ({ data: [...] })
  // or as a plain array normalise to always be an array.
  const studentList = Array.isArray(students)
    ? students
    : (students?.data ?? []);

  // Loading
  if (loading) return (
    <div className="min-h-screen bg-[#f4f7fe] px-4 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <LoadingSkeleton variant="page" count={1} />
      </div>
    </div>
  );

  // Not found
  if (error || !section) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <i className="fas fa-triangle-exclamation text-5xl" style={{ color: '#fdb813' }} />
      <h2 className="text-xl font-black" style={{ color: '#1d2b4b' }}>Section not found.</h2>
      <Link to="/sections" className="font-semibold no-underline" style={{ color: '#3f51b5' }}>
        ← Back to Sections
      </Link>
    </div>
  );

  const hiddenCount = (counts?.total ?? 0) - (counts?.visible ?? studentList.length);

  return (
    <div className="min-h-screen flex flex-col"
      style={{ background: '#f8fafc', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{`
        @keyframes fadeInUp {
          from { opacity:0; transform:translateY(20px) }
          to   { opacity:1; transform:translateY(0)    }
        }
        .stu-chip {
          animation:  fadeInUp 0.45s ease forwards;
          opacity:    0;
          transition: transform 0.3s, box-shadow 0.3s;
        }
        .stu-chip:hover {
          transform:  translateY(-6px);
          box-shadow: 0 15px 35px rgba(29,43,75,0.1);
        }
      `}</style>

      <Navbar />

      {/* Hero Header */}
      <header style={{
        background:   'linear-gradient(135deg, #1d2b4b, #3f51b5)',
        padding:      '60px 8% 80px',
        borderRadius: '0 0 60px 60px',
        color:        'white',
      }}>
        <Link to="/sections"
          className="inline-flex items-center gap-2 text-sm no-underline mb-6 transition-opacity"
          style={{ color: 'rgba(255,255,255,0.55)' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '0.55'}>
          <i className="fas fa-arrow-left" /> Back to Sections
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(253,184,19,0.2)' }}>
                <i className="fas fa-layer-group" style={{ color: '#fdb813' }} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest m-0"
                  style={{ opacity: 0.55 }}>
                  {section.batch?.name ?? section.course?.split(' ').slice(-2).join(' ')}
                </p>
                <h1 className="font-black m-0" style={{ fontSize: '2.2rem', letterSpacing: '-1px' }}>
                  Section {section.name}
                </h1>
              </div>
            </div>

            <p style={{ opacity: 0.65, fontSize: '0.9rem', margin: 0 }}>
              {section.course}
              {section.batch?.graduation_year && ` · Batch ${section.batch.graduation_year}`}
            </p>
          </div>

          {/* Stats bubble */}
          <div className="text-center rounded-2xl p-5"
            style={{ background: 'rgba(255,255,255,0.1)', minWidth: '130px' }}>
            <p className="font-black m-0" style={{ fontSize: '2.5rem', color: '#fdb813' }}>
              {counts?.total ?? studentList.length}
            </p>
            <p className="text-xs font-semibold m-0" style={{ opacity: 0.65 }}>
              total students
            </p>
            {!isPremium && hiddenCount > 0 && (
              <p className="text-xs mt-1 m-0" style={{ opacity: 0.5 }}>
                {counts?.visible ?? studentList.length} visible
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Access Notice */}
      {!isPremium ? (
        <div className="mx-[8%] mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4"
          style={{
            background: 'linear-gradient(135deg, #1d2b4b, #3f51b5)',
            color:      'white',
          }}>
          <div className="flex items-center gap-3">
            <i className="fas fa-lock" style={{ color: '#fdb813', fontSize: '1.2rem' }} />
            <div>
              <p className="font-extrabold text-sm m-0">
                {hiddenCount > 0
                  ? `${hiddenCount} classmate${hiddenCount !== 1 ? 's' : ''} hidden`
                  : 'Upgrade for full profiles'}
              </p>
              <p className="text-xs m-0" style={{ opacity: 0.7 }}>
                Premium unlocks all classmates, full bios, mottos & contact info.
              </p>
            </div>
          </div>
          <Link to="/premium"
            className="no-underline font-bold text-xs px-5 py-3 rounded-xl whitespace-nowrap"
            style={{ background: '#fdb813', color: '#1d2b4b' }}>
            Upgrade Now <i className="fas fa-arrow-right ml-1" />
          </Link>
        </div>
      ) : (
        <div className="mx-[8%] mt-6 flex items-center gap-3 rounded-2xl px-6 py-4"
          style={{ background: 'white', border: '1.5px solid #e2e8f0' }}>
          <i className="fas fa-crown" style={{ color: '#fdb813' }} />
          <p className="text-sm font-semibold m-0" style={{ color: '#1d2b4b' }}>
            Premium Access · Showing all {counts?.visible ?? studentList.length} visible classmates
            {hiddenCount > 0 && (
              <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                {' '}({hiddenCount} private account{hiddenCount !== 1 ? 's' : ''} hidden by their owners)
              </span>
            )}
          </p>
        </div>
      )}

      {/* Students Grid */}
      <main style={{ padding: '40px 8% 80px', flex: 1 }}>
        <h2 className="font-black mb-6" style={{ fontSize: '1.15rem', color: '#1d2b4b' }}>
          {isPremium ? 'All Classmates' : 'Public Profiles'}
          <span className="ml-2 text-sm font-semibold" style={{ color: '#94a3b8' }}>
            ({studentList.length})
          </span>
        </h2>

        {studentList.length > 0 ? (
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap:                 '22px',
          }}>
            {studentList.map((student, i) => {
              const name  = fullName(student);
              const photo = storageUrl(student.photo);

              return (
                // FIX: navigate to DiscoveryStudentProfile via /discover/students/:id
                <Link
                  key={student.id}
                  to={`/discover/students/${student.id}`}
                  className="no-underline relative block"
                >
                  <div
                    className="stu-chip bg-white rounded-2xl overflow-hidden"
                    style={{
                      border:         '1px solid #e8ecf4',
                      animationDelay: `${i * 0.04}s`,
                    }}>

                    {/* Photo */}
                    <div style={{
                      height:   '195px',
                      overflow: 'hidden',
                      background: '#1d2b4b',
                      position: 'relative',
                    }}>
                      {photo ? (
                        <img
                          src={photo}
                          alt={name}
                          className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                      ) : null}
                      {/* Fallback initials shown when no photo or photo fails to load */}
                      <div
                        className="w-full h-full items-center justify-center"
                        style={{
                          fontSize:   '3rem',
                          fontWeight: 900,
                          color:      '#fdb813',
                          display:    photo ? 'none' : 'flex',
                        }}>
                        {getInitials(student)}
                      </div>

                      {/* Year badge */}
                      {student.graduation_year && (
                        <span className="absolute top-2 right-2 text-xs font-bold px-2 py-1 rounded-lg"
                          style={{ background: 'rgba(0,0,0,0.45)', color: 'white' }}>
                          '{String(student.graduation_year).slice(-2)}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ padding: '14px 16px 16px' }}>
                      {/* FIX: use first_name + last_name NOT student.name */}
                      <h4 className="font-black truncate m-0"
                        style={{ fontSize: '0.92rem', color: '#1d2b4b', lineHeight: 1.3 }}>
                        {name}
                      </h4>

                      {/* FIX: use student_no NOT student_id */}
                      <p className="text-xs m-0 mt-1" style={{ color: '#94a3b8' }}>
                        {student.student_no ?? 'N/A'}
                      </p>

                      {/* Premium-only fields */}
                      {isPremium && student.email && (
                        <p className="text-xs mt-2 truncate m-0" style={{ color: '#64748b' }}>
                          <i className="fas fa-envelope mr-1" style={{ opacity: 0.5 }} />
                          {student.email}
                        </p>
                      )}
                      {isPremium && student.motto && (
                        <p className="text-xs italic mt-2 m-0"
                          style={{ color: '#64748b', lineHeight: 1.4 }}>
                          "{student.motto}"
                        </p>
                      )}
                      {isPremium && (
                        <VisibilityBadge visibility={student.profile_visibility} />
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}

            {/* Ghost locked cards */}
            {!isPremium && hiddenCount > 0 &&
              Array.from({ length: Math.min(hiddenCount, 6) }).map((_, i) => (
                <div key={`locked-${i}`} className="relative" style={{ minHeight: '280px' }}>
                  <div className="bg-white rounded-2xl overflow-hidden h-full"
                    style={{ border: '1.5px dashed #cbd5e1', opacity: 0.6 }}>
                    <div style={{ height: '195px', background: '#f1f5f9' }} />
                    <div style={{ padding: '14px 16px' }}>
                      <div className="h-3 rounded-full mb-2"
                        style={{ background: '#e2e8f0', width: '70%' }} />
                      <div className="h-2 rounded-full"
                        style={{ background: '#f1f5f9', width: '50%' }} />
                    </div>
                  </div>
                  <LockedOverlay />
                </div>
              ))
            }
          </div>
        ) : (
          /* Empty State */
          <div className="text-center py-24"
            style={{ background: 'white', borderRadius: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
            <i className="fas fa-users text-6xl mb-5 block opacity-10" style={{ color: '#1d2b4b' }} />
            <h3 className="text-xl font-black mb-2" style={{ color: '#1d2b4b' }}>
              {!isPremium ? 'No Public Profiles' : 'No Students Yet'}
            </h3>
            <p className="text-sm" style={{ color: '#94a3b8' }}>
              {!isPremium
                ? 'Upgrade to Premium to see all classmates in this section.'
                : 'No students have been assigned to this section yet.'}
            </p>
            {!isPremium && (
              <Link to="/premium"
                className="inline-block mt-5 font-bold text-sm no-underline px-7 py-3 rounded-xl"
                style={{ background: '#1d2b4b', color: 'white' }}>
                <i className="fas fa-crown mr-2" style={{ color: '#fdb813' }} />
                Upgrade to Premium
              </Link>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
