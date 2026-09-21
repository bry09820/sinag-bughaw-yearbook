import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { studentsApi } from '@/api/student.api';
import { profileApi } from '@/api/gallery.api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import MessageModal from '@/components/feedback/MessageModal';
import ShareModal from '@/features/profile/components/ShareModal';
import PremiumBadge from '@/features/subscription/components/PremiumBadge';
import SubscriptionGate from '@/features/subscription/components/SubscriptionGate';
import StudentPhotosSection from '../components/StudentPhotosSection';
import PostLightbox from '../components/PostLightbox';
import PostContextMenu from '../components/PostContextMenu';
import VoiceNotesSection from '@/features/messaging/components/VoiceNotesSection';
import { imageUrl, avatarUrl as makeAvatar } from '@/utils/imageUrl';
import { recordProfileView } from '@/api/analytics.api';
import { trackProfileView } from '@/utils/ga4';
import { getCourseShort } from '@/utils/courseShort';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

// Helpers
const isGraduate = (student) => !!student?.graduation_year;
const isMeaningfulText = (value, minLength = 3) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const compact = text.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (text.length < minLength || compact.length < minLength) return false;
  if (/^(test|asdf|qwerty|sample|lorem|abc|haha)+$/i.test(compact)) return false;
  if (/^(.)\1{2,}$/.test(compact)) return false;
  return true;
};
const postMediaItems = (post) => {
  if (Array.isArray(post?.media) && post.media.length) return post.media;
  return post?.file_path || post?.url || post?.path ? [post] : [];
};
const shouldShowProfilePost = (post) => {
  const status = String(post?.status || post?.moderation_status || post?.approval_status || '').toLowerCase();
  if (['pending', 'rejected', 'unapproved', 'hidden', 'flagged'].includes(status)) return false;
  if (post?.is_approved === false || post?.approved === false || post?.is_public === false) return false;
  return postMediaItems(post).length > 0 || isMeaningfulText(post?.caption || post?.body || post?.message, 3);
};
const isPaidViewer = (viewer) => {
  if (!viewer) return false;
  const tier = String(viewer.tier || '').toLowerCase();
  const plan = String(viewer.plan || '').toLowerCase();
  return Boolean(viewer.is_premium || ['standard', 'premium'].includes(tier) || plan.startsWith('premium'));
};

// Sub-components
function SkeletonBlock({ w = '60%', h = 11 }) {
  return <div className="rounded-md bg-slate-200 animate-pulse" style={{ width: w, height: h }} />;
}

function LockedGrid() {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse"
          style={{ background: `hsl(${220 + i * 10}, ${14 + i * 2}%, ${88 - i * 2}%)` }} />
      ))}
    </div>
  );
}

function ViewCard({ icon, label, children }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <h4 className="flex items-center gap-2 text-xs font-black text-[#1d2b4b] uppercase tracking-widest m-0 mb-4">
        <i className={`${icon} text-[#fdb813] text-xs`} />{label}
      </h4>
      {children}
    </div>
  );
}

function InfoTile({ icon, label, value }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <i className={`fas ${icon} text-[#fdb813] text-[9px]`} />
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-semibold text-[#1d2b4b] m-0 break-words">{value}</p>
    </div>
  );
}

// Main component
function initialsFor(name = '') {
  return String(name || 'NU')
    .trim()
    .split(/\s+/)
    .map(part => part[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('') || 'NU';
}

const pickFirst = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
const publicStudentField = (student, ...keys) => {
  const sources = [
    student,
    student?.data,
    student?.student,
    student?.user,
    student?.profile,
    student?.student_record,
    student?.studentRecord,
  ].filter(Boolean);

  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return '';
};

function RestrictedProfileView({ student, visibility, authUser, onBack, onLogin }) {
  const name = publicStudentField(student, 'name', 'full_name')
    || [publicStudentField(student, 'first_name'), publicStudentField(student, 'last_name')].filter(Boolean).join(' ')
    || 'Student Profile';
  const photo = imageUrl(publicStudentField(student, 'profile_picture', 'profile_pic', 'avatar', 'photo_url', 'photo', 'image_url'));
  const rawCourse = publicStudentField(student, 'course', 'program', 'strand');
  const course = publicStudentField(student, 'course_short') || getCourseShort(rawCourse) || rawCourse || 'Student';
  const sectionName = pickFirst(student?.section?.name, student?.student_record?.section, student?.studentRecord?.section);
  const batch = publicStudentField(student, 'graduation_year', 'batch_year', 'batch') || student?.section?.batch_year || student?.batch?.graduation_year;
  const isBatchmatesOnly = visibility === 'batchmates' || visibility === 'alumni_only';
  const isSubscriptionLimited = visibility === 'subscription';
  const badge = isSubscriptionLimited ? 'Free Tier' : isBatchmatesOnly ? 'Batchmates Only' : 'Private Profile';
  const metaSeparator = ' · ';
  const details = [rawCourse || course, 'National University Lipa'].filter(Boolean).join(' · ');
  const profileMeta = [details, sectionName].filter(Boolean).join(metaSeparator);
  const loggedIn = Boolean(authUser);
  const studentNo = publicStudentField(student, 'student_no', 'student_id');
  const stats = [
    { value: course, label: 'Program' },
    { value: studentNo || 'N/A', label: 'ID' },
    { value: batch || 'N/A', label: 'Batch' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f2f7]">
      <Navbar />
      <main className="flex-1">
        <section className="bg-[#f0f2f7] px-4 pt-5 sm:pt-8">
          <div className="mx-auto max-w-[840px] rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="relative h-[128px] overflow-hidden rounded-t-2xl bg-[#1d2b4b] bg-[radial-gradient(circle_at_84%_8%,rgba(79,96,190,0.42),transparent_32%)]">
              <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:18px_18px]" />
              <button type="button" onClick={onBack}
                className="absolute left-5 top-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-white/80 cursor-pointer hover:bg-white/15">
                <i className="fas fa-chevron-left text-[10px]" /> Back
              </button>
            </div>
            <div className="px-5 pb-6 sm:px-8">
              <div className="-mt-12 flex items-end justify-between gap-4">
                <div className="relative z-10 shrink-0">
                  <div className="inline-block rounded-full bg-gradient-to-br from-[#fdb813] to-amber-500 p-[3px]">
                    <div className="inline-block rounded-full bg-white p-[3px]">
                      {photo ? (
                        <img
                          src={photo}
                          alt={name}
                          className="h-24 w-24 rounded-full bg-[#1d2b4b] object-cover shadow-xl"
                        />
                      ) : (
                        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#14213d] text-3xl font-black text-[#fdb813] shadow-xl">
                          {initialsFor(name)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="absolute bottom-2 right-2 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400" />
                </div>

                <div className="flex items-center gap-2 pb-2 pt-14">
                  <button
                    type="button"
                    disabled
                    className="hidden cursor-not-allowed items-center gap-2 rounded-xl border-none bg-[#1d2b4b] px-4 py-2.5 text-xs font-black text-white opacity-60 sm:inline-flex"
                  >
                    <i className="fas fa-paper-plane text-[#fdb813]" /> Message
                  </button>
                  <button
                    type="button"
                    className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                    onClick={() => navigator.clipboard?.writeText(window.location.href)}
                    aria-label="Copy profile link"
                  >
                    <i className="fas fa-share-alt" />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex flex-col items-start gap-2">
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <h1 className="m-0 text-[22px] font-black leading-tight text-[#1d2b4b]">{name}</h1>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-700">
                      <i className="fas fa-lock text-[9px]" /> {badge}
                    </span>
                  </div>
                  <p className="m-0 text-sm font-semibold text-[#38517c]">
                    {profileMeta}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-5 border-b border-slate-100 pb-4">
                  {stats.map((item) => (
                    <div key={item.label} className="text-center">
                      <p className="m-0 max-w-[130px] break-words text-sm font-black leading-tight text-[#1d2b4b]">{item.value}</p>
                      <p className="m-0 mt-1 text-[10px] font-medium text-slate-400">{item.label}</p>
                    </div>
                  ))}
                </div>
                <p className="m-0 mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                  <i className="fas fa-university text-[#3f51b5] text-[10px]" /> NU Lipa
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-5 w-[calc(100%-32px)] max-w-[840px] rounded-xl border border-slate-200 bg-white/60 p-5 shadow-sm backdrop-blur-md pointer-events-none">
          <div className="relative overflow-hidden rounded-lg bg-white/40 p-4">
            <div className="space-y-3 opacity-70 blur-[2px]">
              <div className="h-4 w-3/4 rounded-full bg-slate-300" />
              <div className="h-4 w-full rounded-full bg-slate-200" />
              <div className="h-4 w-2/3 rounded-full bg-slate-200" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[6px]">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                <i className="fas fa-lock text-[#fdb813]" /> Content hidden
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-5 mb-12 w-[calc(100%-32px)] max-w-[840px] rounded-2xl border border-slate-100 bg-white p-5 sm:p-8 text-center shadow-md shadow-slate-200/70">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fdb813]/15 text-[#fdb813]">
            <i className="fas fa-users text-xl" />
          </div>
          <h2 className="m-0 text-[18px] font-semibold text-[#1d2b4b]">
            {isSubscriptionLimited ? 'Profile details locked' : 'This profile is private'}
          </h2>
          <p className="mx-auto mt-3 mb-0 max-w-[330px] text-sm leading-relaxed text-slate-500">
            {isSubscriptionLimited
              ? 'Full profile details are hidden on free tier. Upgrade to unlock the complete profile, gallery access, and contact details.'
              : !loggedIn
              ? 'Only students from the same batch can view the full profile. Sign in with your NU Lipa student account to check access.'
              : `You're not in the same batch as ${name}. Only their batchmates can view this profile.`}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {!loggedIn && (
              <button type="button" onClick={onLogin}
                className="w-full rounded-xl border-none bg-[#fdb813] px-5 py-3 text-sm font-black text-[#1d2b4b] cursor-pointer transition hover:bg-amber-300">
                Sign In with NU Account
              </button>
            )}
            <button type="button" onClick={onBack}
              className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-500 cursor-pointer transition hover:bg-slate-50">
              ← Back to Directory
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default function StudentProfileView() {
  const { id }             = useParams();
  const { user: authUser } = useAuth();
  const navigate           = useNavigate();
  const [searchParams]     = useSearchParams();

  const [student,          setStudent]          = useState(null);
  const [restrictedStudent,setRestrictedStudent]= useState(null);
  const [loading,          setLoading]          = useState(true);
  const [visibility,       setVisibility]       = useState(null);
  const [activeTab,        setActiveTab]        = useState('posts');
  const [showMsg,          setShowMsg]          = useState(false);
  const [showShare,        setShowShare]        = useState(false);
  const [posts,            setPosts]            = useState([]);
  const [postsRestricted,  setPostsRestricted]  = useState(false);
  const [postsLoading,     setPostsLoading]     = useState(false);
  const [lightbox,         setLightbox]         = useState(null);
  const [contextMenu,      setContextMenu]      = useState(null);
  const [toast,            setToast]            = useState(null);
  const [achievements,     setAchievements]     = useState([]);
  const [achieveLoading,   setAchieveLoading]   = useState(false);
  const postParam = searchParams.get('post');

  const canViewFull = Boolean(student?.is_subscribed_viewer || isPaidViewer(authUser));

  // Build tabs dynamically Yearbook only for graduates
  const TABS = [
    { key: 'posts',        icon: 'fas fa-th-large',      label: 'Posts'          },
    { key: 'tagged',       icon: 'fas fa-tag',            label: 'Tagged'         },
    ...(student && isGraduate(student)
      ? [{ key: 'yearbook', icon: 'fas fa-book-open',     label: 'Yearbook'       }]
      : []),
    { key: 'academic',     icon: 'fas fa-graduation-cap', label: 'Academic'       },
    { key: 'achievements', icon: 'fas fa-award',          label: 'Achievements'   },
    { key: 'voice',        icon: 'fas fa-microphone',     label: 'Voice Memories' },
  ];

  // Fetch student + record view
  useEffect(() => {
    if (!id) return;
    if (parseInt(id) === authUser?.id) {
      navigate(`/profile${postParam ? `?post=${encodeURIComponent(postParam)}` : ''}`, { replace: true });
      return;
    }
    setLoading(true);
    studentsApi.show(id)
      .then(({ data }) => {
        setStudent(data);
        setRestrictedStudent(null);
        setVisibility(null);
        // id here is users.id correct for profile_views table
        recordProfileView(parseInt(id));
        trackProfileView({
          id:     parseInt(id),
          name:   data.name   ?? '',
          course: data.course ?? '',
          batch:  data.graduation_year ?? '',
        });
      })
      .catch(err => {
        const payload = err.response?.data ?? {};
        setVisibility(payload.visibility ?? null);
        setRestrictedStudent(payload.student ?? null);
        setStudent(null);
      })
      .finally(() => setLoading(false));
  }, [id, authUser, navigate, postParam]);

  useEffect(() => {
    if (activeTab === 'posts' && student) loadPosts();
  }, [activeTab, id, student]);

  useEffect(() => {
    if (postParam) setActiveTab('posts');
  }, [postParam]);

  useEffect(() => {
    if (!postParam || postsLoading || !posts.length) return;

    const post = posts.find((p) => String(p.id) === String(postParam));
    if (post) setLightbox(post);
  }, [postParam, posts, postsLoading]);

  useEffect(() => {
    if (activeTab === 'achievements' && canViewFull && id) loadAchievements();
  }, [activeTab, id, canViewFull]);

  const loadPosts = () => {
    setPostsLoading(true);
    profileApi.getPosts(id)
      .then(({ data }) => {
        if (data.restricted) { setPostsRestricted(true); setPosts([]); }
        else { setPostsRestricted(false); setPosts((data.data?.data ?? data.data ?? []).filter(shouldShowProfilePost)); }
      })
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  };

  const loadAchievements = () => {
    setAchieveLoading(true);
    studentsApi.getAchievements(id)
      .then(res => {
        const data = res.data?.data ?? res.data ?? [];
        if (Array.isArray(data) && data.length) {
          setAchievements(data.map(a => {
            let meta = {};
            try { meta = JSON.parse(a.type || '{}'); } catch {}
            return { id: a.id, title: a.title, sub: a.subtitle ?? '', icon: meta.icon ?? 'fa-star', color: meta.color ?? '#fdb813' };
          }));
        } else {
          setAchievements([]);
        }
      })
      .catch(() => setAchievements([]))
      .finally(() => setAchieveLoading(false));
  };

  const showToastMsg = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handlePostDeleted = (pid) => { setPosts(p => p.filter(x => x.id !== pid)); showToastMsg('Post deleted.', 'error'); setContextMenu(null); };
  const handlePostUpdated = (u)   => { setPosts(p => p.map(x => x.id === u.id ? { ...x, ...u } : x)); showToastMsg('Updated!'); setContextMenu(null); };
  const handleReportPost = async (post) => {
    try {
      await profileApi.reportPost(post.id);
      setPosts(prev => prev.map(item => item.id === post.id
        ? {
            ...item,
            is_reported: true,
            media: (item.media ?? []).map(media => ({ ...media, is_reported: true })),
          }
        : item));
      showToastMsg('Report submitted for admin review.');
    } catch (err) {
      showToastMsg(err.response?.data?.message ?? 'Failed to report this post.', 'error');
    }
  };

  // Loading
  if (loading) return (
    <div className="min-h-screen bg-[#f4f7fe] px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <LoadingSkeleton variant="page" count={1} />
      </div>
    </div>
  );

  // Not found / private
  if (!student && ['subscription', 'private', 'batchmates', 'alumni_only'].includes(visibility)) return (
    <RestrictedProfileView
      student={restrictedStudent}
      visibility={visibility}
      authUser={authUser}
      onBack={() => navigate('/directory')}
      onLogin={() => navigate('/login')}
    />
  );

  if (!student) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f7fe] gap-3 px-4 text-center">
      <i className={`fas ${visibility === 'private' ? 'fa-lock' : visibility === 'batchmates' ? 'fa-users' : 'fa-user-slash'} text-5xl text-slate-200`} />
      <h2 className="text-lg font-black text-[#1d2b4b] m-0">
        {visibility === 'private'     ? 'This profile is private.'     : ''}
        {visibility === 'batchmates'  ? 'This profile is for batchmates only.' : ''}
        {!visibility                  ? 'Student not found.'           : ''}
      </h2>
      <p className="text-sm text-slate-400 m-0">
        {visibility === 'private'     ? 'The student has restricted access to their profile.' : ''}
        {visibility === 'batchmates'  ? 'Only students from the same batch can view it.'     : ''}
      </p>
      <button onClick={() => navigate('/directory')}
        className="bg-transparent border-none text-[#3f51b5] text-sm font-semibold cursor-pointer">
        ← Back to Directory
      </button>
    </div>
  );

  const graduate    = isGraduate(student);
  const batchYear   = student.graduation_year || student.section?.batch_year || new Date().getFullYear();
  const courseShort = student.course_short || getCourseShort(student.course);
  const avatar      = imageUrl(student.profile_picture) || makeAvatar(student.name);

  return (
    <div className="min-h-screen bg-[#f4f7fe] flex flex-col font-sans">
      <Navbar />

      <MessageModal isOpen={showMsg}   onClose={() => setShowMsg(false)}   student={student} authUser={authUser} />
      <ShareModal   isOpen={showShare} onClose={() => setShowShare(false)} student={student} />
      {contextMenu && (
        <PostContextMenu post={contextMenu.post} position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)} onDelete={handlePostDeleted} onUpdated={handlePostUpdated} />
      )}

      {lightbox && <PostLightbox post={lightbox} onClose={() => setLightbox(null)} />}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 left-1/2 z-[9000] -translate-x-1/2 animate-[fadeIn_0.2s_ease] px-5 py-2.5 rounded-xl text-sm font-semibold shadow-xl
                         whitespace-nowrap flex items-center gap-2
                         ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-[#1d2b4b] text-white'}`}>
          <i className={`fas ${toast.type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check'} text-[#fdb813]`} />
          {toast.msg}
        </div>
      )}

      <main className="flex-1 max-w-[980px] mx-auto w-full px-4 sm:px-6 py-8 animate-[fadeIn_0.25s_ease]">

        {/* PROFILE CARD */}
        <div className="bg-white rounded-2xl overflow-hidden mb-3 shadow-sm border border-slate-100">

          {/* Cover */}
          <div className="h-28 sm:h-36 relative overflow-hidden bg-gradient-to-br from-[#1d2b4b] via-[#2d4270] to-[#3f51b5]">
            <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(circle,#fdb813_1.5px,transparent_1.5px)] bg-[length:22px_22px]" />
            <div className="absolute -top-16 -right-16 w-52 h-52 rounded-full bg-[#fdb813]/5" />
            <button onClick={() => navigate(-1)}
              className="absolute top-4 left-5 flex items-center gap-1.5 text-white/75 hover:text-white bg-white/10 backdrop-blur-sm border border-white/15 rounded-lg px-3 py-1.5 cursor-pointer text-xs font-semibold transition">
              <i className="fas fa-arrow-left text-[10px]" /> Back
            </button>
          </div>

          {/* Body */}
          <div className="px-5 sm:px-8 pb-6">
            <div className="flex items-end justify-between mb-4 -mt-12 sm:-mt-14">

              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="p-[3px] rounded-full bg-gradient-to-br from-[#fdb813] to-amber-500 inline-block">
                  <div className="p-[3px] rounded-full bg-white inline-block">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-[#1d2b4b]">
                      <img src={avatar} alt={student.name} className="w-full h-full object-cover block"
                        onError={e => { e.currentTarget.src = makeAvatar(student.name); }} />
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-14 sm:pt-16">
                <button onClick={() => setShowMsg(true)}
                  className="inline-flex items-center gap-2 bg-[#1d2b4b] hover:bg-[#162038] text-white px-5 py-2 rounded-xl text-sm font-semibold border-none cursor-pointer transition">
                  <i className="fas fa-paper-plane text-[#fdb813] text-xs" /> Message
                </button>
                <button onClick={() => setShowShare(true)}
                  className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 cursor-pointer flex items-center justify-center transition text-sm">
                  <i className="fas fa-share-alt" />
                </button>
              </div>
            </div>

            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-black text-[#1d2b4b] m-0 leading-none">{student.name}</h1>
              {student.is_premium && <PremiumBadge size="sm" />}
              {graduate && canViewFull && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full tracking-wide flex items-center gap-1">
                  <i className="fas fa-graduation-cap text-[8px]" /> GRADUATE {batchYear}
                </span>
              )}
              {canViewFull && !graduate && (
                <span className="text-[10px] font-bold text-[#3f51b5] bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full tracking-wide">
                  PIONEER {batchYear}
                </span>
              )}
            </div>

            {canViewFull && (
              <p className="text-sm text-slate-500 font-medium mb-4">
                {student.course ?? 'Pioneer Student'} · National University Lipa
              </p>
            )}

            {/* Stats */}
            <div className="flex gap-6 flex-wrap mb-4 pb-4 border-b border-slate-100">
              {[
                { value: canViewFull ? posts.length                  : '—',    label: 'Posts'   },
                { value: canViewFull ? (student.profile_views ?? 0)  : '—',    label: 'Views'   },
                { value: canViewFull ? courseShort                    : '🔒',   label: 'Program' },
                { value: canViewFull ? (student.student_id ?? 'N/A') : '••••', label: 'ID'      },
                { value: canViewFull ? batchYear                      : '—',    label: 'Batch'   },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-base font-black text-[#1d2b4b] m-0 leading-none">{s.value}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-1 m-0">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Bio gated */}
            <SubscriptionGate isSubscribed={canViewFull} variant="inline"
              message="Subscribe to view this student's bio and personal quote."
              preview={
                <div className="pl-3 border-l-[3px] border-[#fdb813] space-y-2 py-1">
                  <SkeletonBlock w="75%" /><SkeletonBlock w="50%" h={9} />
                </div>
              }
            >
              <p className="text-sm text-slate-500 leading-relaxed italic m-0 mb-2 pl-3 border-l-[3px] border-[#fdb813]">
                "{student.bio || 'No quote yet.'}"
              </p>
              {student.motto && (
                <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 mt-1">
                  <i className="fas fa-quote-left text-[#fdb813] text-[9px]" />
                  <span className="text-xs text-amber-800 italic">{student.motto}</span>
                </div>
              )}
            </SubscriptionGate>

            {canViewFull && (
              <div className="flex gap-4 mt-3 flex-wrap items-center">
                {student.hometown && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    <i className="fas fa-map-marker-alt text-red-400 text-[10px]" /> {student.hometown}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <i className="fas fa-university text-[#3f51b5] text-[10px]" /> NU Lipa
                </span>
                {graduate && (student.facebook_url || student.instagram_url || student.linkedin_url || student.github_url) && (
                  <div className="flex items-center gap-2 ml-auto">
                    {student.facebook_url  && <a href={student.facebook_url}  target="_blank" rel="noopener noreferrer" className="text-[#1877F2] text-sm hover:opacity-75 transition"><i className="fab fa-facebook" /></a>}
                    {student.instagram_url && <a href={student.instagram_url} target="_blank" rel="noopener noreferrer" className="text-[#E1306C] text-sm hover:opacity-75 transition"><i className="fab fa-instagram" /></a>}
                    {student.linkedin_url  && <a href={student.linkedin_url}  target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] text-sm hover:opacity-75 transition"><i className="fab fa-linkedin" /></a>}
                    {student.github_url    && <a href={student.github_url}    target="_blank" rel="noopener noreferrer" className="text-[#1d2b4b] text-sm hover:opacity-75 transition"><i className="fab fa-github" /></a>}
                  </div>
                )}
              </div>
            )}

            {/* Free-tier lock nudge */}
            {!canViewFull && (
              <div className="mt-4 inline-flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <i className="fas fa-lock text-[#fdb813] text-sm" />
                <span className="text-xs text-amber-800 font-semibold">Full profile visible to Premium members.</span>
                <button onClick={() => navigate('/premium')}
                  className="bg-transparent border-none text-[#3f51b5] text-xs font-bold cursor-pointer p-0">
                  Upgrade →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* TABS */}
        <div className="bg-white rounded-2xl mb-3 shadow-sm border border-slate-100 flex overflow-hidden">
          {TABS.map((tab, i) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[11px] font-bold tracking-wide
                border-none cursor-pointer transition-all border-b-2
                ${activeTab === tab.key ? 'text-[#1d2b4b] border-[#1d2b4b] bg-slate-50' : 'text-slate-400 border-transparent bg-white hover:text-slate-600 hover:bg-slate-50'}
                ${i < TABS.length - 1 ? 'border-r border-r-slate-100' : ''}`}>
              <i className={`${tab.icon} text-[11px] ${activeTab === tab.key ? 'text-[#fdb813]' : ''}`} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* POSTS TAB */}
        {activeTab === 'posts' && (
          <SubscriptionGate isSubscribed={!postsRestricted && canViewFull} variant="full"
            message="Subscribe to view this student's posts, photos, and memories."
            preview={<LockedGrid />}
          >
            {postsLoading ? (
              <LoadingSkeleton variant="feed" count={2} />
            ) : posts.length === 0 ? (
              <div className="bg-white rounded-2xl py-20 flex flex-col items-center text-center shadow-sm border border-slate-100 px-6">
                <div className="w-16 h-16 rounded-full border-2 border-[#1d2b4b]/20 flex items-center justify-center mb-4">
                  <i className="fas fa-camera text-[#1d2b4b]/30 text-2xl" />
                </div>
                <h3 className="text-lg font-black text-[#1d2b4b] mb-1">No Posts Yet</h3>
                <p className="text-sm text-slate-400">No memories shared here yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden shadow-sm">
                {posts.map(post => (
                  <div key={post.id} className="group relative aspect-square overflow-hidden bg-[#1d2b4b] cursor-pointer"
                    onClick={() => !contextMenu && setLightbox(post)}
                    onContextMenu={e => { e.preventDefault(); setContextMenu({ post, x: e.clientX, y: e.clientY }); }}
                  >
                    {post.file_path?.match(/\.(mp4|mov|webm)(\?|$)/i)
                      ? <video src={post.file_path} className="w-full h-full object-cover block transition-transform duration-300 group-hover:scale-105" muted />
                      : <img   src={post.file_path} alt={post.caption ?? ''} className="w-full h-full object-cover block transition-transform duration-300 group-hover:scale-105" />
                    }
                    <div className="absolute inset-0 bg-[#1d2b4b]/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100 flex items-center justify-center gap-5">
                      <span className="text-white text-sm font-bold"><i className="fas fa-heart text-[#fdb813] mr-1" />0</span>
                      <span className="text-white text-sm font-bold"><i className="fas fa-comment text-[#fdb813] mr-1" />0</span>
                    </div>
                    <button
                      type="button"
                      title={post.is_reported || post.media?.some(item => item?.is_reported) ? 'Reported for review' : 'Report this post'}
                      disabled={post.is_reported || post.media?.some(item => item?.is_reported)}
                      onClick={e => {
                        e.stopPropagation();
                        if (!(post.is_reported || post.media?.some(item => item?.is_reported))) handleReportPost(post);
                      }}
                      className={`absolute bottom-2 right-2 z-[4] flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-xs text-white backdrop-blur-sm transition ${
                        post.is_reported || post.media?.some(item => item?.is_reported)
                          ? 'cursor-default bg-emerald-600/85'
                          : 'cursor-pointer bg-[#1d2b4b]/75 hover:bg-red-600/85'
                      }`}
                    >
                      <i className={`fas ${post.is_reported || post.media?.some(item => item?.is_reported) ? 'fa-check' : 'fa-flag'}`} />
                    </button>
                    {post.caption && (
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#1d2b4b]/85 to-transparent px-2.5 pb-2 pt-6 text-[11px] text-white font-medium leading-tight">
                        {post.caption.length > 38 ? post.caption.slice(0, 38) + '…' : post.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SubscriptionGate>
        )}

        {/* TAGGED TAB */}
        {activeTab === 'tagged' && (
          <SubscriptionGate isSubscribed={canViewFull} variant="full" message="Subscribe to view tagged photos."
            preview={<div className="bg-white rounded-2xl p-6 space-y-3"><SkeletonBlock /><SkeletonBlock w="40%" /><SkeletonBlock w="70%" /></div>}
          >
            <ViewCard icon="fas fa-tag" label="Tagged Photos">
              <StudentPhotosSection userId={parseInt(id)} compact openInModal />
            </ViewCard>
          </SubscriptionGate>
        )}

        {/* YEARBOOK TAB graduates only */}
        {activeTab === 'yearbook' && graduate && (
          <SubscriptionGate isSubscribed={canViewFull} variant="full"
            message="Subscribe to view this graduate's full yearbook profile."
            preview={
              <div className="bg-white rounded-2xl p-6 space-y-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="space-y-2 pb-4 border-b border-slate-100 last:border-0">
                    <SkeletonBlock w="30%" h={9} />
                    <SkeletonBlock w="80%" h={11} />
                    <SkeletonBlock w="60%" h={11} />
                  </div>
                ))}
              </div>
            }
          >
            <div className="flex flex-col gap-3">

              {/* Graduate banner */}
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <i className="fas fa-graduation-cap text-emerald-600 text-base" />
                </div>
                <div>
                  <p className="text-sm font-black text-emerald-800 m-0">
                    {student.honors ? `${student.honors} Graduate` : 'Graduate'} · Class of {batchYear}
                  </p>
                  <p className="text-xs text-emerald-600 m-0 mt-0.5">
                    {student.course} · National University Lipa
                  </p>
                </div>
              </div>

              {/* Personal */}
              {(student.nickname || student.birthday || student.hometown) && (
                <ViewCard icon="fas fa-user" label="Personal">
                  <div className="grid grid-cols-2 gap-3">
                    {student.nickname && <InfoTile icon="fa-smile"          label="Nickname" value={student.nickname} />}
                    {student.birthday && (
                      <InfoTile icon="fa-cake-candles" label="Birthday" value={
                        new Date(student.birthday).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                      } />
                    )}
                    {student.hometown && <InfoTile icon="fa-map-marker-alt" label="Hometown" value={student.hometown} />}
                  </div>
                </ViewCard>
              )}

              {/* Honors & Organizations */}
              {(student.honors || student.organizations || student.achievements) && (
                <ViewCard icon="fas fa-medal" label="Honors & Organizations">
                  {student.honors && (
                    <div className={`${student.organizations || student.achievements ? 'mb-3 pb-3 border-b border-slate-100' : ''}`}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Honors</p>
                      <p className="text-sm font-semibold text-[#1d2b4b] m-0">{student.honors}</p>
                    </div>
                  )}
                  {student.organizations && (
                    <div className={student.achievements ? 'mb-3 pb-3 border-b border-slate-100' : ''}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Organizations</p>
                      <p className="text-sm text-slate-600 m-0 leading-relaxed">{student.organizations}</p>
                    </div>
                  )}
                  {student.achievements && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Achievements</p>
                      <p className="text-sm text-slate-600 m-0 leading-relaxed">{student.achievements}</p>
                    </div>
                  )}
                </ViewCard>
              )}

              {/* Yearbook Quotes */}
              {(student.ambition || student.future_plans || student.fondest_memory || student.most_likely_to) && (
                <ViewCard icon="fas fa-feather-pointed" label="Yearbook Quotes">
                  {[
                    { label: 'Ambition',       icon: 'fa-rocket',  value: student.ambition       },
                    { label: 'Future Plans',   icon: 'fa-map',     value: student.future_plans   },
                    { label: 'Fondest Memory', icon: 'fa-heart',   value: student.fondest_memory },
                    { label: 'Most Likely To', icon: 'fa-trophy',  value: student.most_likely_to },
                  ].filter(r => r.value).map((row, i, arr) => (
                    <div key={row.label} className={`pb-3 mb-3 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <i className={`fas ${row.icon} text-[#fdb813] text-[10px]`} />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">{row.label}</p>
                      </div>
                      <p className="text-sm text-slate-600 italic m-0 leading-relaxed pl-3 border-l-2 border-amber-200">
                        "{row.value}"
                      </p>
                    </div>
                  ))}
                </ViewCard>
              )}

              {/* Messages */}
              {(student.message_to_batchmates || student.message_to_parents) && (
                <ViewCard icon="fas fa-envelope-open-text" label="Messages">
                  {student.message_to_batchmates && (
                    <div className={student.message_to_parents ? 'mb-3 pb-3 border-b border-slate-100' : ''}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <i className="fas fa-users text-[#fdb813] text-[10px]" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">To My Batchmates</p>
                      </div>
                      <p className="text-sm text-slate-600 italic m-0 leading-relaxed pl-3 border-l-2 border-indigo-200">
                        "{student.message_to_batchmates}"
                      </p>
                    </div>
                  )}
                  {student.message_to_parents && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <i className="fas fa-house-heart text-[#fdb813] text-[10px]" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">To My Parents</p>
                      </div>
                      <p className="text-sm text-slate-600 italic m-0 leading-relaxed pl-3 border-l-2 border-rose-200">
                        "{student.message_to_parents}"
                      </p>
                    </div>
                  )}
                </ViewCard>
              )}

              {/* Social Links */}
              {(student.facebook_url || student.instagram_url || student.linkedin_url || student.github_url) && (
                <ViewCard icon="fas fa-share-nodes" label="Social Links">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { url: student.facebook_url,  icon: 'fa-facebook',  label: 'Facebook',  color: '#1877F2' },
                      { url: student.instagram_url, icon: 'fa-instagram', label: 'Instagram', color: '#E1306C' },
                      { url: student.linkedin_url,  icon: 'fa-linkedin',  label: 'LinkedIn',  color: '#0A66C2' },
                      { url: student.github_url,    icon: 'fa-github',    label: 'GitHub',    color: '#1d2b4b' },
                    ].filter(s => s.url).map(s => (
                      <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-slate-50
                                   hover:bg-white hover:shadow-sm text-sm font-semibold no-underline text-[#1d2b4b] transition">
                        <i className={`fab ${s.icon} text-base`} style={{ color: s.color }} />
                        {s.label}
                      </a>
                    ))}
                  </div>
                </ViewCard>
              )}

            </div>
          </SubscriptionGate>
        )}

        {/* ACADEMIC TAB */}
        {activeTab === 'academic' && (
          <SubscriptionGate isSubscribed={canViewFull} variant="full" message="Subscribe to view academic information."
            preview={
              <div className="bg-white rounded-2xl p-6">
                <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => (
                  <div key={i} className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2">
                    <SkeletonBlock w="40%" h={9} /><SkeletonBlock w="65%" h={13} />
                  </div>
                ))}</div>
              </div>
            }
          >
            <ViewCard icon="fas fa-graduation-cap" label="Academic Info">
              <div className="grid grid-cols-2 gap-3 mb-3">
                {[
                  { label: 'Course',     value: student.course || 'N/A',    icon: 'fa-book'          },
                  { label: 'Year Level', value: student.year_level ? `${student.year_level}th Year` : '4th Year', icon: 'fa-layer-group' },
                  { label: 'Status',     value: 'Enrolled',                 icon: 'fa-circle-check',  green: true },
                  { label: 'Batch',      value: batchYear,                  icon: 'fa-calendar'      },
                ].map(row => (
                  <div key={row.label} className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <i className={`fas ${row.icon} text-[#fdb813] text-[9px]`} />
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{row.label}</span>
                    </div>
                    <p className={`text-sm font-bold m-0 ${row.green ? 'text-emerald-500' : 'text-[#1d2b4b]'}`}>{row.value}</p>
                  </div>
                ))}
              </div>
            </ViewCard>
          </SubscriptionGate>
        )}

        {/* ACHIEVEMENTS TAB */}
        {activeTab === 'achievements' && (
          <SubscriptionGate isSubscribed={canViewFull} variant="full" message="Subscribe to view this student's achievements."
            preview={
              <div className="bg-white rounded-2xl p-6 space-y-4">
                {[1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2"><SkeletonBlock w="55%" h={11} /><SkeletonBlock w="35%" h={9} /></div>
                  </div>
                ))}
              </div>
            }
          >
            <ViewCard icon="fas fa-award" label="Achievements">
              {achieveLoading ? (
                <LoadingSkeleton variant="row" count={3} gridClassName="space-y-3" />
              ) : achievements.length === 0 ? (
                <div className="flex flex-col items-center text-center py-12">
                  <div className="w-14 h-14 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center mb-4">
                    <i className="fas fa-award text-slate-300 text-xl" />
                  </div>
                  <p className="text-sm font-bold text-[#1d2b4b] mb-1">No Achievements Yet</p>
                  <p className="text-xs text-slate-400">This student hasn't added any achievements yet.</p>
                </div>
              ) : (
                achievements.map((a, i, arr) => (
                  <div key={a.id ?? i}
                    className={`flex items-center gap-4 py-4 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                    <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                      <i className={`fas ${a.icon} text-base`} style={{ color: a.color }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-[#1d2b4b] m-0 mb-0.5">{a.title}</p>
                      <p className="text-xs text-slate-400 m-0">{a.sub}</p>
                    </div>
                    <i className="fas fa-chevron-right text-slate-200 text-xs" />
                  </div>
                ))
              )}
            </ViewCard>
          </SubscriptionGate>
        )}

        {/* VOICE MEMORIES TAB */}
        {activeTab === 'voice' && (
          <SubscriptionGate isSubscribed={canViewFull} variant="full" message="Subscribe to listen to voice memories."
            preview={
              <div className="bg-white rounded-2xl p-6 space-y-4">
                {[1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-0">
                    <div className="w-10 h-10 rounded-full bg-slate-100 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2"><SkeletonBlock w="60%" h={9} /><SkeletonBlock w="80%" h={7} /></div>
                  </div>
                ))}
              </div>
            }
          >
            <ViewCard icon="fas fa-microphone" label="Voice Memories">
              <VoiceNotesSection profileUser={student} isOwnProfile={false} />
            </ViewCard>
          </SubscriptionGate>
        )}

      </main>
      <Footer />
    </div>
  );
}
