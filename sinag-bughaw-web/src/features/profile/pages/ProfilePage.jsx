import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { studentsApi } from '@/api/student.api';
import { profileApi } from '@/api/gallery.api';
import { voiceNotesApi } from '@/api/messaging.api';
import { storageUrl } from '@/api/client';
import { useAuth } from '@/features/auth/hooks/useAuth';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import StudentPhotosSection from '../components/StudentPhotosSection';
import ProfileUploadModal from '../components/ProfileUploadModal';
import PostContextMenu from '../components/PostContextMenu';
import ShareModal from '../components/ShareModal';
import PostCard from '../components/PostCard';
import PostLightbox from '../components/PostLightbox';
import { useChatHeads } from '@/features/messaging/context/ChatHeadsContext';
import { useAppConfig } from '@/features/platform/AppConfigProvider';
import { getCourseShort } from '@/utils/courseShort';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';
import { getSubscriptionTier } from '@/utils/subscription';

// Helpers
const isGraduate = (student) => !!student?.graduation_year;
const getTier = (u) => getSubscriptionTier(u);
const isMeaningfulText = (value, minLength = 10) => {
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

const TIER_CONFIG = {
  premium:  { label: 'Premium',  icon: 'fa-crown',  cls: 'bg-amber-50 text-amber-700 border border-amber-200'   },
  standard: { label: 'Standard', icon: 'fa-bolt',   cls: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  free:     { label: 'Free',     icon: 'fa-user',   cls: 'bg-slate-100 text-slate-500 border border-slate-200'   },
};
const PROFILE_TABS = new Set(['posts', 'tagged', 'academic', 'achievements', 'voicenotes']);

// Sub-components
function TabCard({ icon, label, action, children }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h4 className="flex items-center gap-2 text-xs font-black text-[#1d2b4b] uppercase tracking-widest m-0">
          <i className={`${icon} text-[#fdb813] text-xs`} />
          {label}
        </h4>
        {action}
      </div>
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
const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

async function makeAvatarFile({ file, previewUrl, zoom, x, y }) {
  const size = 512;
  const image = await loadImage(previewUrl);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const scale = baseScale * zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = (size / 2) + ((x / 100) * size) - (drawWidth / 2);
  const drawY = (size / 2) + ((y / 100) * size) - (drawHeight / 2);

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Could not prepare profile photo.');

  const name = file?.name?.replace(/\.[^.]+$/, '') || 'profile-photo';
  return new File([blob], `${name}-profile.jpg`, { type: 'image/jpeg' });
}

function ProfilePhotoEditor({ draft, saving, fileRef, setDraft, onCancel, onSave }) {
  const dragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const clampPosition = (value) => Math.max(-45, Math.min(45, Math.round(value)));

  if (!draft) return null;

  const previewStyle = {
    left: `${50 + draft.x}%`,
    top: `${50 + draft.y}%`,
    transform: `translate(-50%, -50%) scale(${draft.zoom})`,
    width: draft.aspect >= 1 ? 'auto' : '100%',
    height: draft.aspect >= 1 ? '100%' : 'auto',
  };
  const startDrag = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: draft.x,
      originY: draft.y,
    };
  };
  const moveDrag = (e) => {
    if (!dragRef.current.active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nextX = dragRef.current.originX + ((e.clientX - dragRef.current.startX) / rect.width) * 100;
    const nextY = dragRef.current.originY + ((e.clientY - dragRef.current.startY) / rect.height) * 100;
    setDraft(current => ({ ...current, x: clampPosition(nextX), y: clampPosition(nextY) }));
  };
  const stopDrag = (e) => {
    dragRef.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="fixed inset-0 z-[9500] bg-[#0f172a]/55 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="m-0 text-base font-black text-[#1d2b4b]">Profile Photo</h3>
            <p className="m-0 mt-0.5 text-xs text-slate-400">Position your photo before saving.</p>
          </div>
          <button type="button" onClick={onCancel}
            className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-[#1d2b4b] cursor-pointer">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div
            className="mx-auto w-56 h-56 rounded-full overflow-hidden bg-slate-100 border-[5px] border-[#fdb813] relative shadow-inner cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            <img src={draft.previewUrl} alt="Profile preview"
              crossOrigin="anonymous"
              className="absolute max-w-none select-none pointer-events-none"
              style={previewStyle}
              onLoad={(e) => {
                const image = e.currentTarget;
                const aspect = image.naturalWidth / image.naturalHeight;
                setDraft(current => current ? { ...current, aspect } : current);
              }}
              draggable="false"
            />
          </div>
          <p className="m-0 mt-3 text-center text-xs font-semibold text-slate-400">Drag the photo to reposition it.</p>

          <div className="mt-5">
            <label className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Zoom</span>
                <span className="text-[11px] font-bold text-[#1d2b4b]">{Math.round(draft.zoom * 100)}%</span>
              </div>
              <input type="range" min="1" max="2.4" step="0.01" value={draft.zoom}
                onChange={(e) => setDraft(current => ({ ...current, zoom: Number(e.target.value) }))}
                className="w-full accent-[#fdb813]"
              />
            </label>
          </div>
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-[#1d2b4b] cursor-pointer hover:bg-slate-100">
            <i className="fas fa-image text-[#fdb813]" /> Choose Another
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-500 cursor-pointer hover:bg-slate-100">
              Cancel
            </button>
            <button type="button" onClick={onSave} disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl border-none bg-[#1d2b4b] px-4 py-2.5 text-xs font-black text-white cursor-pointer disabled:opacity-60">
              <i className={`fas ${saving ? 'fa-spinner animate-spin' : 'fa-check'} text-[#fdb813]`} />
              {saving ? 'Saving...' : 'Save Photo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { id }             = useParams();
  const { user: authUser } = useAuth();
  const { openChat }       = useChatHeads();
  const { isOn }           = useAppConfig();
  const navigate           = useNavigate();
  const [searchParams] = useSearchParams();
  const postsEnabled       = isOn('allow_student_posts');
  const premiumBilling     = isOn('enable_premium_subscription');

  const [student,           setStudent]           = useState(null);
  const [loading,           setLoading]           = useState(true);
  const [bio,               setBio]               = useState('');
  const [editing,           setEditing]           = useState(false);
  const [toast,             setToast]             = useState(null);
  const postParam = searchParams.get('post');
  const tabParam = searchParams.get('tab');
  const noteParam = searchParams.get('note');
  const [activeTab,         setActiveTab]         = useState(() => {
    if (postParam) return 'posts';
    return PROFILE_TABS.has(tabParam) ? tabParam : 'posts';
  });
  const [showUpload,        setShowUpload]        = useState(false);
  const [showShare,         setShowShare]         = useState(false);
  const [posts,             setPosts]             = useState([]);
  const [postsLoading,      setPostsLoading]      = useState(false);
  const [contextMenu,       setContextMenu]       = useState(null);
  const [lightbox,          setLightbox]          = useState(null);
  const [voiceNotes,        setVoiceNotes]        = useState([]);
  const [voiceNotesLoading, setVoiceNotesLoading] = useState(false);
  const [photoDraft,        setPhotoDraft]        = useState(null);
  const [photoSaving,       setPhotoSaving]       = useState(false);

  const [academicData,    setAcademicData]    = useState(null);
  const [academicLoading, setAcademicLoading] = useState(false);
  const [achievements,    setAchievements]    = useState([]);
  const [achieveLoading,  setAchieveLoading]  = useState(false);

  const fileRef = useRef();
  const profileId = id ?? authUser?.id;
  const isOwn   = Boolean(authUser?.id && String(authUser.id) === String(profileId));
  const openedPostRef = useRef(null);
  const openedVoiceNoteRef = useRef(null);
  const userTier   = getTier(authUser);
  const isPremium  = userTier === 'premium' || userTier === 'standard';
  const isFree     = isOwn && premiumBilling && !isPremium;
  const tierConfig = TIER_CONFIG[userTier];

  // Build tabs dynamically only show Yearbook for graduates
  const TABS = [
    { key: 'posts',        icon: 'fas fa-th-large',      label: 'Posts'        },
    { key: 'tagged',       icon: 'fas fa-tag',            label: 'Tagged'       },
    ...(student && isGraduate(student)
      ? [{ key: 'yearbook', icon: 'fas fa-book-open',     label: 'Yearbook'     }]
      : []),
    { key: 'academic',     icon: 'fas fa-graduation-cap', label: 'Academic'     },
    { key: 'achievements', icon: 'fas fa-award',          label: 'Achievements' },
    { key: 'voicenotes',   icon: 'fas fa-microphone',     label: 'Voice Notes'  },
  ];

  // Load student profile
  useEffect(() => {
    if (!profileId) return;
    setLoading(true);
    studentsApi.show(profileId)
      .then(({ data }) => { setStudent(data); setBio(data.bio ?? ''); })
      .finally(() => setLoading(false));
  }, [profileId]);

  useEffect(() => { if (activeTab === 'posts')        loadPosts();        }, [activeTab, profileId]);
  useEffect(() => { if (activeTab === 'voicenotes')   loadVoiceNotes();   }, [activeTab, profileId]);
  useEffect(() => { if (activeTab === 'achievements') loadAchievements(); }, [activeTab, profileId]);
  useEffect(() => { if (activeTab === 'academic')     loadAcademic();     }, [activeTab, profileId]);

  useEffect(() => {
    if (postParam) setActiveTab('posts');
  }, [postParam]);

  useEffect(() => {
    if (!postParam && PROFILE_TABS.has(tabParam)) setActiveTab(tabParam);
  }, [postParam, tabParam]);

  useEffect(() => {
    if (!postParam || postsLoading || !posts.length || openedPostRef.current === postParam) return;

    const post = posts.find((p) => String(p.id) === String(postParam));
    if (!post) return;

    openedPostRef.current = postParam;
    setLightbox({ post, idx: 0 });
  }, [postParam, posts, postsLoading]);

  useEffect(() => {
    if (!noteParam || voiceNotesLoading || !voiceNotes.length || openedVoiceNoteRef.current === noteParam) return;

    const note = voiceNotes.find((item) => String(item.id) === String(noteParam));
    if (!note) return;

    openedVoiceNoteRef.current = noteParam;
    document.getElementById(`voice-note-${noteParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [noteParam, voiceNotes, voiceNotesLoading]);

  useEffect(() => () => {
    if (photoDraft?.isObjectUrl && photoDraft?.previewUrl) URL.revokeObjectURL(photoDraft.previewUrl);
  }, [photoDraft?.isObjectUrl, photoDraft?.previewUrl]);

  const loadPosts = () => {
    if (!profileId) return;
    setPostsLoading(true);
    profileApi.getPosts(profileId)
      .then(({ data }) => setPosts((data.data?.data ?? data.data ?? []).filter(shouldShowProfilePost)))
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  };

  const loadVoiceNotes = () => {
    if (!profileId) return;
    setVoiceNotesLoading(true);
    const req = isOwn ? voiceNotesApi.inbox() : voiceNotesApi.forProfile(profileId);
    req.then(({ data }) => setVoiceNotes(Array.isArray(data) ? data : []))
       .catch(() => setVoiceNotes([]))
       .finally(() => setVoiceNotesLoading(false));
  };

  const loadAchievements = () => {
    if (!profileId) return;
    setAchieveLoading(true);
    studentsApi.getAchievements(profileId)
      .then(res => {
        const data = res.data?.data ?? res.data ?? [];
        if (Array.isArray(data) && data.length) {
          setAchievements(data.map(a => {
            let meta = {};
            try { meta = JSON.parse(a.type || '{}'); } catch { /* keep default achievement metadata */ }
            return { id: a.id, t: a.title, s: a.subtitle ?? '', icon: meta.icon ?? 'fa-star', color: meta.color ?? '#fdb813' };
          }));
        } else {
          setAchievements([]);
        }
      })
      .catch(() => setAchievements([]))
      .finally(() => setAchieveLoading(false));
  };

  const loadAcademic = () => {
    if (!profileId) return;
    setAcademicLoading(true);
    studentsApi.show(profileId)
      .then(({ data }) => {
        // Prefer live auth payload for own-account tier so profile matches Navbar/Directory.
        const tierSource = isOwn && authUser ? authUser : data;
        setAcademicData({
          student_id:      data.student_id      ?? null,
          course:          data.course          ?? null,
          graduation_year: data.graduation_year ?? null,
          batch:           data.batch           ?? null,
          year_level:      data.year_level      ?? null,
          status:          data.status          ?? data.academic_status
            ?? (data.graduation_year || data.role === 'alumni' ? 'Alumni' : null),
          is_premium:      Boolean(tierSource.is_premium),
          tier:            getTier(tierSource),
        });
      })
      .catch(() => setAcademicData(null))
      .finally(() => setAcademicLoading(false));
  };

  const formatDuration = (s) => {
    if (!s) return null;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    if (type === 'success') window.dispatchEvent(new Event('notifications:refresh'));
    setTimeout(() => setToast(null), 3000);
  };

  const saveBio = async () => {
    if (bio.trim() && !isMeaningfulText(bio, 10)) {
      showToast('Please enter a meaningful bio.', 'error');
      return;
    }
    try {
      await studentsApi.updateBio(bio);
      setStudent(prev => ({ ...prev, bio }));
      setEditing(false);
      showToast('Your profile bio was updated successfully.');
    } catch {
      showToast('Failed to update your profile bio.', 'error');
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.', 'error');
      e.target.value = '';
      return;
    }
    setPhotoDraft(current => {
      if (current?.isObjectUrl && current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file), isObjectUrl: true, zoom: 1, x: 0, y: 0, aspect: 1 };
    });
    e.target.value = '';
  };

  const closePhotoEditor = () => {
    setPhotoDraft(current => {
      if (current?.isObjectUrl && current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setPhotoSaving(false);
  };

  const saveProfilePhoto = async () => {
    if (!photoDraft || photoSaving) return;
    setPhotoSaving(true);
    try {
      const croppedFile = await makeAvatarFile(photoDraft);
      const fd = new FormData();
      fd.append('photo', croppedFile);
      const { data } = await studentsApi.updatePhoto(fd);
      setStudent(prev => ({ ...prev, profile_picture: data.profile_picture }));
      showToast('Your profile picture was updated successfully.');
      closePhotoEditor();
    } catch {
      showToast('Failed to update your profile picture.', 'error');
      setPhotoSaving(false);
    }
  };

  const handlePostDeleted = (pid) => {
    setPosts(prev => prev.filter(p => p.id !== pid));
    showToast('Post deleted.', 'error');
    setContextMenu(null);
  };

  const handlePostUpdated = (updated) => {
    setPosts(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    showToast('Your post was updated successfully.');
    setContextMenu(null);
  };

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
      showToast('Report submitted for admin review.');
    } catch (err) {
      showToast(err.response?.data?.message ?? 'Failed to report this post.', 'error');
    }
  };

  const handleOpenUpload = () => {
    if (!postsEnabled) return;
    if (premiumBilling && isFree) navigate('/premium');
    else setShowUpload(true);
  };

  if (loading) return (
    <div className="min-h-screen bg-[#f4f7fe] px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <LoadingSkeleton variant="page" count={1} />
      </div>
    </div>
  );

  if (!student) return (
    <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
      Student not found.
    </div>
  );

  const graduate = isGraduate(student);

  const avatar = storageUrl(student.profile_picture)
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=1d2b4b&color=fdb813&bold=true&size=400`;

  const courseShort = student.course_short || getCourseShort(student.course);
  const openProfilePhotoEditor = () => {
    if (!isOwn) return;
    if (!student.profile_picture) {
      fileRef.current?.click();
      return;
    }

    setPhotoDraft(current => {
      if (current?.isObjectUrl && current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return { file: null, previewUrl: avatar, isObjectUrl: false, zoom: 1, x: 0, y: 0, aspect: 1 };
    });
  };

  const openAcademicTab = () => {
    setActiveTab('academic');
    requestAnimationFrame(() => {
      document.getElementById('profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openStudentIdEditor = () => navigate('/settings');

  const hasProgram = !!student.course && courseShort !== 'N/A';
  const hasStudentId = !!student.student_id && student.student_id !== 'N/A';
  const statItems = [
    { value: posts.length, label: 'Posts' },
    { value: student.profile_views ?? 0, label: 'Views' },
    {
      value: hasProgram ? courseShort : 'Add \u2192',
      label: 'Program',
      onClick: openAcademicTab,
      empty: !hasProgram,
    },
    {
      value: hasStudentId ? student.student_id : 'Add \u2192',
      label: 'ID',
      onClick: isOwn ? openStudentIdEditor : null,
      empty: !hasStudentId,
    },
    { value: student.graduation_year ?? student.batch ?? 'N/A', label: 'Batch' },
  ];

  return (
    <div className="min-h-screen bg-[#f4f7fe] flex flex-col font-sans">
      <style>{`
        @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(-8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        .post-cell:hover .post-overlay { opacity: 1 !important; }
        .post-cell:hover img, .post-cell:hover video { transform: scale(1.04); }
        .post-cell img, .post-cell video { transition: transform 0.35s ease; }
      `}</style>

      <Navbar />

      {showUpload  && <ProfileUploadModal onClose={() => setShowUpload(false)} onSuccess={() => { setShowUpload(false); loadPosts(); }} />}
      <ProfilePhotoEditor
        draft={photoDraft}
        saving={photoSaving}
        fileRef={fileRef}
        setDraft={setPhotoDraft}
        onCancel={closePhotoEditor}
        onSave={saveProfilePhoto}
      />
      <ShareModal   isOpen={showShare} onClose={() => setShowShare(false)} student={student} />
      {contextMenu && (
        <PostContextMenu
          post={contextMenu.post}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onDelete={handlePostDeleted}
          onUpdated={handlePostUpdated}
        />
      )}
      {lightbox && <PostLightbox post={lightbox.post} initialIdx={lightbox.idx} onClose={() => setLightbox(null)} />}

      {toast && (
        <div className={`fixed top-20 left-1/2 z-[9000] px-5 py-2.5 rounded-xl text-sm font-semibold
                         shadow-xl whitespace-nowrap flex items-center gap-2
                         ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-[#1d2b4b] text-white'}`}
          style={{ transform: 'translateX(-50%)', animation: 'toastIn 0.25s ease' }}>
          <i className={`fas ${toast.type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check'} text-[#fdb813]`} />
          {toast.msg}
        </div>
      )}

      <main className="flex-1 max-w-[900px] mx-auto w-full px-4 sm:px-6 py-8 animate-[fadeUp_0.35s_ease]">

        {/* PROFILE CARD */}
        <div className="bg-white rounded-2xl overflow-hidden mb-3 shadow-sm border border-slate-100">

          {/* Cover */}
          <div className="h-28 sm:h-36 relative overflow-hidden bg-gradient-to-br from-[#1d2b4b] via-[#2d4270] to-[#3f51b5]">
            <div className="absolute inset-0 opacity-[0.07]"
              style={{ backgroundImage: 'radial-gradient(circle, #fdb813 1.5px, transparent 1.5px)', backgroundSize: '22px 22px' }} />
            <div className="absolute -top-16 -right-16 w-52 h-52 rounded-full bg-[#fdb813]/5" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-white/[0.03]" />
          </div>

          {/* Body */}
          <div className="px-5 sm:px-8 pb-6">
            <div className="flex items-end justify-between mb-4 -mt-12 sm:-mt-14">

              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="p-[3px] rounded-full bg-gradient-to-br from-[#fdb813] to-amber-500 inline-block">
                  <div className="p-[3px] rounded-full bg-white inline-block">
                    <div
                      className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-[#1d2b4b] ${isOwn ? 'cursor-pointer' : ''}`}
                      onClick={openProfilePhotoEditor}
                    >
                      <img src={avatar} alt={student.name}
                        className="w-full h-full object-cover block"
                        onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=1d2b4b&color=fdb813&bold=true`; }}
                      />
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
                {isOwn && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
                    <button onClick={openProfilePhotoEditor}
                      className="absolute -bottom-0 left-1/2 -translate-x-1/2 bg-[#1d2b4b]/80 backdrop-blur-sm text-white text-[9px] font-black px-2 py-0.5 rounded-full border-none cursor-pointer whitespace-nowrap tracking-wide">
                      EDIT
                    </button>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-14 sm:pt-16 flex-wrap justify-end">
                {isOwn ? (
                  <>
                    {premiumBilling && (userTier === 'premium' ? (
                      <Link to="/premium" className="inline-flex items-center gap-1.5 bg-gradient-to-r from-[#fdb813] to-amber-500 text-[#1d2b4b] no-underline px-3 py-2 rounded-xl text-xs font-black shadow-md shadow-amber-200/50 hover:opacity-90 transition">
                        <i className="fas fa-crown text-[10px]" /> Premium Active
                      </Link>
                    ) : userTier === 'standard' ? (
                      <Link to="/premium" className="inline-flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-[#3f51b5] text-white no-underline px-3 py-2 rounded-xl text-xs font-black shadow-md shadow-indigo-200/50 hover:opacity-90 transition">
                        <i className="fas fa-bolt text-[10px]" /> Standard
                      </Link>
                    ) : (
                      <Link to="/premium" className="inline-flex items-center gap-1.5 bg-gradient-to-r from-[#fdb813] to-amber-500 text-[#1d2b4b] no-underline px-3 py-2 rounded-xl text-xs font-black shadow-md shadow-amber-200/40 hover:opacity-90 transition">
                        <i className="fas fa-crown text-[10px]" /> Go Premium
                      </Link>
                    ))}
                    <Link to="/settings"
                      className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-[#1d2b4b] no-underline px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 transition">
                      <i className="fas fa-pen text-[10px]" /> Edit Profile
                    </Link>
                    {postsEnabled && (
                      <button onClick={handleOpenUpload}
                        title={premiumBilling && isFree ? 'Upgrade to upload' : 'Add post'}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border-none cursor-pointer transition
                          ${premiumBilling && isFree ? 'bg-slate-300 text-slate-500' : 'bg-[#1d2b4b] hover:bg-[#162038] text-white'}`}>
                        <i className={`fas ${premiumBilling && isFree ? 'fa-lock' : 'fa-plus'} text-[10px] text-[#fdb813]`} />
                        {premiumBilling && isFree ? 'Locked' : 'Add Post'}
                      </button>
                    )}
                  </>
                ) : (
                  <button onClick={() => openChat(student)}
                    className="inline-flex items-center gap-2 bg-[#1d2b4b] hover:bg-[#162038] text-white px-5 py-2 rounded-xl text-sm font-semibold border-none cursor-pointer transition">
                    <i className="fas fa-paper-plane text-[#fdb813] text-xs" /> Message
                  </button>
                )}
                <button onClick={() => setShowShare(true)}
                  className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 cursor-pointer flex items-center justify-center transition text-sm">
                  <i className="fas fa-share-alt" />
                </button>
              </div>
            </div>

            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-black text-[#1d2b4b] m-0 leading-none">{student.name}</h1>
              {graduate && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full tracking-wide flex items-center gap-1">
                  <i className="fas fa-graduation-cap text-[8px]" /> GRADUATE {student.graduation_year}
                </span>
              )}
              {!graduate && (student.graduation_year || student.batch) && (
                <span className="text-[10px] font-bold text-[#3f51b5] bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full tracking-wide">
                  PIONEER {student.graduation_year ?? student.batch}
                </span>
              )}
              {isOwn && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${tierConfig.cls}`}>
                  <i className={`fas ${tierConfig.icon} text-[8px]`} />
                  {tierConfig.label.toUpperCase()}
                </span>
              )}
            </div>

            {/* Course */}
            <p className="text-sm text-slate-500 font-medium mb-4">
              {student.course ?? 'Pioneer Student'} · National University Lipa
            </p>

            {/* Stats row */}
            <div className="flex gap-6 flex-wrap mb-4 pb-4 border-b border-slate-100">
              {statItems.map(s => (
                <div key={s.label} className="text-center">
                  <button
                    type="button"
                    onClick={s.onClick}
                    disabled={!s.onClick}
                    className={`block border-0 bg-transparent p-0 text-base font-black leading-none ${s.onClick ? 'cursor-pointer hover:text-[#fdb813]' : 'cursor-default'} ${s.empty ? 'text-[#fdb813]' : 'text-[#1d2b4b]'}`}
                  >
                    {s.value}
                  </button>
                  <p className="text-[10px] text-slate-400 font-medium mt-1 m-0">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Bio */}
            {editing ? (
              <div className="mb-2">
                <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
                  placeholder="Write your yearbook quote…"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl resize-none border-2 border-[#3f51b5] font-sans text-sm text-[#1d2b4b] outline-none box-border bg-white"
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveBio}
                    className="px-4 py-2 rounded-lg border-none bg-[#1d2b4b] text-white text-xs font-semibold cursor-pointer hover:bg-[#162038] transition">
                    Save
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-xs font-semibold cursor-pointer hover:bg-slate-100 transition">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p
                onClick={() => isOwn && setEditing(true)}
                className={`text-sm text-slate-500 leading-relaxed italic m-0 mb-2 pl-3 border-l-[3px] border-[#fdb813] ${isOwn ? 'cursor-pointer hover:text-slate-700 transition-colors' : ''}`}
              >
                "{student.bio || (isOwn ? 'Click to add your yearbook quote…' : 'No quote yet.')}"
                {isOwn && <i className="fas fa-pen-to-square ml-2 text-slate-300 text-[10px]" />}
              </p>
            )}

            {/* Motto */}
            {student.motto && (
              <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 mt-1">
                <i className="fas fa-quote-left text-[#fdb813] text-[9px]" />
                <span className="text-xs text-amber-800 italic">{student.motto}</span>
              </div>
            )}

            {/* Location */}
            <div className="flex gap-4 mt-3 flex-wrap">
              {student.hometown && (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <i className="fas fa-map-marker-alt text-red-400 text-[10px]" /> {student.hometown}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <i className="fas fa-university text-[#3f51b5] text-[10px]" /> NU Lipa
              </span>
              {/* Social quick links */}
              {(student.facebook_url || student.instagram_url || student.linkedin_url || student.github_url) && (
                <div className="flex items-center gap-2 ml-auto">
                  {student.facebook_url  && <a href={student.facebook_url}  target="_blank" rel="noopener noreferrer" className="text-[#1877F2] text-sm hover:opacity-75 transition"><i className="fab fa-facebook" /></a>}
                  {student.instagram_url && <a href={student.instagram_url} target="_blank" rel="noopener noreferrer" className="text-[#E1306C] text-sm hover:opacity-75 transition"><i className="fab fa-instagram" /></a>}
                  {student.linkedin_url  && <a href={student.linkedin_url}  target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] text-sm hover:opacity-75 transition"><i className="fab fa-linkedin" /></a>}
                  {student.github_url    && <a href={student.github_url}    target="_blank" rel="noopener noreferrer" className="text-[#1d2b4b] text-sm hover:opacity-75 transition"><i className="fab fa-github" /></a>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TABS */}
        <div id="profile-tabs" className="bg-white rounded-2xl mb-3 shadow-sm border border-slate-100 flex overflow-hidden scroll-mt-24">
          {TABS.map((tab, i) => (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[11px] font-bold tracking-wide
                border-none cursor-pointer transition-all border-b-2
                ${activeTab === tab.key
                  ? 'text-[#1d2b4b] border-[#1d2b4b] bg-slate-50'
                  : 'text-slate-400 border-transparent bg-white hover:text-slate-600 hover:bg-slate-50'
                }
                ${i < TABS.length - 1 ? 'border-r border-r-slate-100' : ''}`}
            >
              <i className={`${tab.icon} text-[11px] ${activeTab === tab.key ? 'text-[#fdb813]' : ''}`} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* POSTS TAB */}
        {activeTab === 'posts' && (
          <div className="flex flex-col gap-3">
            {isOwn && postsEnabled && (
              <div
                onClick={() => (!premiumBilling || !isFree) && setShowUpload(true)}
                className={`bg-white rounded-2xl px-4 py-3 shadow-sm border flex items-center gap-3 transition
                  ${isFree ? 'border-amber-100 cursor-default' : 'border-slate-100 cursor-pointer hover:shadow-md'}`}
              >
                <div className="w-9 h-9 rounded-full overflow-hidden bg-[#1d2b4b] shrink-0 border-2 border-slate-100">
                  <img src={avatar} alt="" className="w-full h-full object-cover"
                    onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=1d2b4b&color=fdb813&bold=true`; }} />
                </div>
                {isFree ? (
                  <div className="flex-1 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-amber-700 font-semibold">
                      <i className="fas fa-lock text-[#fdb813] mr-1.5" />
                      Uploading posts requires a Premium or Standard plan.
                    </span>
                    <Link to="/premium" onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1 bg-gradient-to-r from-[#fdb813] to-amber-500 text-[#1d2b4b] no-underline px-3 py-1.5 rounded-lg text-xs font-black shrink-0">
                      <i className="fas fa-crown text-[10px]" /> Upgrade Now
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-400">
                      Share a memory, {student.name?.split(' ')[0]}…
                    </div>
                    <button className="flex items-center gap-2 bg-[#1d2b4b] text-white border-none rounded-xl px-4 py-2.5 text-xs font-bold cursor-pointer shrink-0">
                      <i className="fas fa-cloud-arrow-up text-[#fdb813]" /> Upload
                    </button>
                  </>
                )}
              </div>
            )}

            {postsLoading ? (
              <LoadingSkeleton variant="feed" count={2} />
            ) : posts.length === 0 ? (
              <div className="bg-white rounded-2xl py-20 flex flex-col items-center text-center shadow-sm border border-slate-100 px-6">
                <div className="w-16 h-16 rounded-full border-2 border-[#1d2b4b]/20 flex items-center justify-center mb-4">
                  <i className="fas fa-camera text-[#1d2b4b]/40 text-2xl" />
                </div>
                <h3 className="text-lg font-black text-[#1d2b4b] mb-2">No Posts Yet</h3>
                <p className="text-sm text-slate-400 mb-4">Share your pioneer memories with your batchmates.</p>
                {isOwn && !isFree && (
                  <button onClick={() => setShowUpload(true)}
                    className="inline-flex items-center gap-2 bg-[#1d2b4b] text-white border-none px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer hover:bg-[#162038] transition">
                    <i className="fas fa-plus text-[#fdb813]" /> Share First Post
                  </button>
                )}
                {isOwn && isFree && (
                  <Link to="/premium"
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-[#fdb813] to-amber-500 text-[#1d2b4b] no-underline px-5 py-2.5 rounded-xl text-sm font-black">
                    <i className="fas fa-crown" /> Upgrade to Post
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden shadow-sm">
                {posts.map(post => (
                  <PostCard key={post.id} post={post} isOwn={isOwn}
                    onClick={(p, idx) => setLightbox({ post: p, idx })}
                    onReportClick={handleReportPost}
                    onMenuClick={(e, p) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setContextMenu({ post: p, x: r.left, y: r.bottom + 6 });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAGGED TAB */}
        {activeTab === 'tagged' && (
          <TabCard icon="fas fa-tag" label="Tagged Photos">
            <StudentPhotosSection userId={Number(profileId)} compact />
          </TabCard>
        )}

        {/* YEARBOOK TAB graduates only */}
        {activeTab === 'yearbook' && graduate && (
          <div className="flex flex-col gap-3">

            {/* Graduate banner */}
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <i className="fas fa-graduation-cap text-emerald-600 text-base" />
              </div>
              <div>
                <p className="text-sm font-black text-emerald-800 m-0">
                  {student.honors ? `${student.honors} Graduate` : 'Graduate'} · Class of {student.graduation_year}
                </p>
                <p className="text-xs text-emerald-600 m-0 mt-0.5">
                  {student.course} · National University Lipa
                </p>
              </div>
            </div>

            {/* Personal */}
            {(student.nickname || student.birthday || student.hometown) && (
              <TabCard icon="fas fa-user" label="Personal">
                <div className="grid grid-cols-2 gap-3">
                  {student.nickname && <InfoTile icon="fa-smile"          label="Nickname" value={student.nickname} />}
                  {student.birthday && (
                    <InfoTile icon="fa-cake-candles" label="Birthday" value={
                      new Date(student.birthday).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    } />
                  )}
                  {student.hometown && <InfoTile icon="fa-map-marker-alt" label="Hometown" value={student.hometown} />}
                </div>
              </TabCard>
            )}

            {/* Honors & Organizations */}
            {(student.honors || student.organizations || student.achievements) && (
              <TabCard icon="fas fa-medal" label="Honors & Organizations">
                {student.honors && (
                  <div className="mb-3 pb-3 border-b border-slate-100">
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
              </TabCard>
            )}

            {/* Yearbook Quotes */}
            {(student.ambition || student.future_plans || student.fondest_memory || student.most_likely_to) && (
              <TabCard icon="fas fa-feather-pointed" label="Yearbook Quotes">
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
              </TabCard>
            )}

            {/* Messages */}
            {(student.message_to_batchmates || student.message_to_parents) && (
              <TabCard icon="fas fa-envelope-open-text" label="Messages">
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
              </TabCard>
            )}

            {/* Social Links */}
            {(student.facebook_url || student.instagram_url || student.linkedin_url || student.github_url) && (
              <TabCard icon="fas fa-share-nodes" label="Social Links">
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
              </TabCard>
            )}
          </div>
        )}

        {/* ACADEMIC TAB */}
        {activeTab === 'academic' && (
          <TabCard icon="fas fa-graduation-cap" label="Academic Info">
            {academicLoading ? (
              <LoadingSkeleton variant="row" count={3} gridClassName="space-y-3" />
            ) : academicData ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[
                    { label: 'Course',     value: academicData.course ?? 'N/A', icon: 'fa-book' },
                    { label: 'Year Level', value: academicData.year_level ?? 'N/A', icon: 'fa-layer-group' },
                    {
                      label: 'Status',
                      value: academicData.status ?? (academicData.graduation_year ? 'Graduated' : 'N/A'),
                      icon: academicData.graduation_year ? 'fa-graduation-cap' : 'fa-circle-check',
                      green: academicData.status || academicData.graduation_year,
                    },
                    { label: 'Batch', value: academicData.batch ?? academicData.graduation_year ?? 'N/A', icon: 'fa-users' },
                  ].map(row => (
                    <div key={row.label} className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <i className={`fas ${row.icon} text-[#fdb813] text-[9px]`} />
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{row.label}</span>
                      </div>
                      <p className={`text-sm font-bold m-0 ${row.green ? 'text-emerald-500' : 'text-[#1d2b4b]'} break-words`}>
                        {row.value}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400 text-center py-8">Could not load academic info.</p>
            )}
          </TabCard>
        )}

        {/* ACHIEVEMENTS TAB */}
        {activeTab === 'achievements' && (
          <TabCard icon="fas fa-award" label="Achievements">
            {achieveLoading ? (
              <LoadingSkeleton variant="row" count={3} gridClassName="space-y-3" />
            ) : achievements.length === 0 ? (
              <div className="flex flex-col items-center text-center py-12">
                <div className="w-14 h-14 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center mb-4">
                  <i className="fas fa-award text-slate-300 text-xl" />
                </div>
                <p className="text-sm font-bold text-[#1d2b4b] mb-1">No Achievements Yet</p>
                <p className="text-xs text-slate-400">
                  {isOwn
                    ? <Link to="/settings" className="text-[#3f51b5] no-underline">Go to Settings to add achievements</Link>
                    : 'No achievements have been added yet.'}
                </p>
              </div>
            ) : (
              achievements.map((a, i, arr) => (
                <div key={a.id ?? i}
                  className={`flex items-center gap-4 py-4 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                    <i className={`fas ${a.icon} text-base`} style={{ color: a.color }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[#1d2b4b] m-0 mb-0.5">{a.t}</p>
                    <p className="text-xs text-slate-400 m-0">{a.s}</p>
                  </div>
                  <i className="fas fa-chevron-right text-slate-200 text-xs" />
                </div>
              ))
            )}
            {isOwn && achievements.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                <Link to="/settings#achievements"
                  className="inline-flex items-center gap-1.5 text-xs text-[#3f51b5] font-semibold no-underline hover:underline">
                  <i className="fas fa-pen-to-square text-[10px]" /> Edit Achievements in Settings
                </Link>
              </div>
            )}
          </TabCard>
        )}

        {/* VOICE NOTES TAB */}
        {activeTab === 'voicenotes' && (
          <TabCard
            icon="fas fa-microphone"
            label={isOwn ? `Voice Notes Received (${voiceNotes.length})` : `Voice Notes for ${student.name?.split(' ')[0]}`}
            action={
              <button onClick={loadVoiceNotes} disabled={voiceNotesLoading}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 bg-transparent cursor-pointer transition">
                <i className={`fas fa-rotate-right text-[10px] ${voiceNotesLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            }
          >
            {voiceNotesLoading ? (
              <LoadingSkeleton variant="row" count={3} gridClassName="space-y-3" />
            ) : voiceNotes.length === 0 ? (
              <div className="flex flex-col items-center text-center py-14">
                <div className="w-14 h-14 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center mb-4">
                  <i className="fas fa-microphone-slash text-slate-300 text-xl" />
                </div>
                <p className="text-sm font-bold text-[#1d2b4b] mb-1">No Voice Notes Yet</p>
                <p className="text-xs text-slate-400">
                  {isOwn ? 'Ask your batchmates to send you a voice memory!' : 'No approved voice notes yet.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {voiceNotes.map(note => {
                  const isTargetNote = noteParam && String(note.id) === String(noteParam);
                  return (
                  <div key={note.id}
                    id={`voice-note-${note.id}`}
                    className={`flex items-center gap-3 p-4 rounded-xl transition-shadow ${isTargetNote ? 'bg-amber-50 border border-amber-300 shadow-md shadow-amber-100' : 'bg-slate-50 border border-slate-100 hover:shadow-sm'}`}>
                    <img
                      src={note.sender?.profile_picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(note.sender?.name ?? 'S')}&background=1d2b4b&color=fdb813&bold=true&size=80`}
                      alt={note.sender?.name}
                      className="w-11 h-11 rounded-full object-cover shrink-0 border-2 border-slate-200"
                      onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(note.sender?.name ?? 'S')}&background=1d2b4b&color=fdb813&bold=true`; }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-bold text-[#1d2b4b]">{note.title ?? 'Voice Memory'}</span>
                        {note.duration_seconds && (
                          <span className="text-[10px] text-slate-400 bg-slate-200 rounded-full px-2 py-0.5 font-semibold">
                            {formatDuration(note.duration_seconds)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mb-2">
                        From <strong className="text-[#1d2b4b]">{note.sender?.name ?? 'Anonymous'}</strong>
                        {' · '}
                        {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <audio controls src={note.audio_url} className="w-full h-8" />
                    </div>
                    {isOwn && (
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 tracking-wide
                        ${note.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          : note.status === 'rejected' ? 'bg-red-50 text-red-500 border border-red-100'
                          : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                        {note.status?.toUpperCase()}
                      </span>
                    )}
                  </div>
                );
                })}
              </div>
            )}
          </TabCard>
        )}

      </main>
      <Footer />
    </div>
  );
}
