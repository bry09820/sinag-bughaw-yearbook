import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { galleryApi, mediaApi } from '@/api/gallery.api';
import { graduationApi, transcriptApi } from '@/api/yearbook.api';
import { useMediaUpload } from '@/hooks/useMediaUpload';
import { useAuth } from '@/features/auth/hooks/useAuth';
import FaceSearchButton from '@/components/ui/FaceSearchButton';
import BulkUploadZone from '@/features/yearbook/components/BulkUploadZone';
import StorageUsageBar from '@/features/yearbook/components/StorageUsageBar';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { imageUrl } from '@/utils/imageUrl';
import ProtectedImage from '@/components/ui/ProtectedImage';
import { ContentOwnershipBanner } from '@/components/ui/CopyrightLabel';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

// Helpers

// REMOVED: safeGetToken() no longer needed.
// All API calls now go through the axios client which handles auth automatically.

const getTier = (user) => {
  if (!user) return 'free';
  if (user.tier === 'premium' || user.is_premium) return 'premium';
  if (user.tier === 'standard') return 'standard';
  return 'free';
};

// Tab config
const TABS = [
  { key: 'general',               label: 'Gallery',       icon: 'fa-photo-film'         },
  { key: 'graduation:photos',     label: 'Graduation',    icon: 'fa-graduation-cap'     },
  { key: 'graduation:videos',     label: 'Videos',        icon: 'fa-film'               },
  { key: 'graduation:mass',       label: 'Baccalaureate', icon: 'fa-church'             },
  { key: 'graduation:program',    label: 'Program',       icon: 'fa-file-pdf'           },
  { key: 'graduation:song',       label: 'Grad Song',     icon: 'fa-music'              },
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', icon: 'fa-globe', hint: 'Visible to everyone' },
  { value: 'batchmates', label: 'Batchmates', icon: 'fa-user-group', hint: 'Only your batch' },
  { value: 'private', label: 'Private', icon: 'fa-lock', hint: 'Only you and admins' },
];

const searchText = (value) => String(value ?? '').toLowerCase();

const albumSearchHaystack = (album, tab) => [
  tab?.label,
  tab?.key,
  album?.title,
  album?.name,
  album?.album_title,
  album?.caption,
  album?.description,
  album?.event_date,
  album?.event_year,
  album?.graduation_year,
  album?.batch_name,
  album?.category,
  album?.type,
  ...albumMediaFiles(album).flatMap(file => [
    file?.title,
    file?.name,
    file?.caption,
    file?.file_name,
    file?.filename,
    file?.original_name,
    file?.description,
    file?.mime_type,
    file?.resource_type,
  ]),
].map(searchText).join(' ');

const categoryToTabKey = (category) => {
  const normalized = String(category ?? '').toLowerCase();
  const aliases = {
    invitations: 'program',
    invitation: 'program',
    songs: 'song',
    speeches: 'videos',
  };
  const tabCategory = aliases[normalized] ?? normalized;
  if (['photos', 'videos', 'program', 'song', 'mass'].includes(tabCategory)) {
    return `graduation:${tabCategory}`;
  }
  return 'general';
};

const apiCategoryForTab = (tabKey) => {
  const category = tabKey.split(':')[1];
  return {
    invitation: 'invitations',
    song: 'songs',
  }[category] ?? category;
};

const albumMediaFiles = (album) => {
  const files = album?.media_files ?? album?.mediaFiles ?? album?.videos ?? [];
  if (files.length > 0) return files;
  return album?.photos ?? [];
};
const albumMediaTitle = (media, fallback = 'Media') => media?.title
  ?? media?.caption
  ?? media?.filename
  ?? media?.file_name
  ?? fallback;
const isApprovedMedia = (item) => {
  const status = String(item?.status || item?.moderation_status || item?.approval_status || item?.pivot?.status || '').toLowerCase();
  if (['rejected', 'denied', 'declined', 'pending', 'unapproved', 'hidden'].includes(status)) return false;
  if (item?.is_approved === false || item?.approved === false || item?.is_public === false) return false;
  return status ? ['approved', 'published', 'active', 'public'].includes(status) : true;
};
const mediaFileRef = (file) => file?.url
  || file?.file_path
  || file?.media_url
  || file?.thumbnail_url
  || file?.preview_url
  || file?.path
  || file?.secure_url
  || file?.src
  || '';
const isImageMedia = (url = '') => /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(String(url));
const isVideoMedia = (file) => {
  const type = String(file?.resource_type ?? file?.file_type ?? file?.mime_type ?? file?.type ?? '').toLowerCase();
  const ref = mediaFileRef(file);
  return type.startsWith('video') || /\.(mp4|mov|webm|mkv|avi|m4v)(\?|$)/i.test(String(ref));
};
const canDeleteMediaItem = (user, album, item) => {
  if (!user || !item) return false;
  if (String(user.role ?? '').toLowerCase() === 'admin' || user.is_admin) return true;

  const ownerIds = [
    item.user_id,
    item.uploaded_by,
    item.gallery?.user_id,
    item.photo?.user_id,
    item.user?.id,
    album?.user_id,
    album?.owner_id,
    album?.user?.id,
  ]
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(value => String(value));

  return ownerIds.includes(String(user.id));
};
const albumMediaCount = (album) => Number(albumMediaFiles(album).length || album?.file_count || album?.media_count || album?.photos_count || (album?.media_url || album?.file_path ? 1 : 0));
const primaryAlbumMedia = (album) => mediaFileRef(albumMediaFiles(album).find(isApprovedMedia)) || '';
const albumCoverMedia = (album) => {
  const firstPhoto = albumMediaFiles(album).find(file => {
    const ref = mediaFileRef(file);
    return isApprovedMedia(file) && !/\.(mp4|mov|webm|mkv|mp3|wav|m4a)(\?|$)/i.test(String(ref));
  });
  return mediaFileRef(firstPhoto) || '';
};
const albumNeedsCoverHydration = (album) => !albumCoverMedia(album) && albumMediaCount(album) > 0;

function AlbumCover({ album, alt, icon = 'fa-images' }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const cover = albumCoverMedia(album);
  const src = cover ? imageUrl(cover) : '';

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1B2A4A] via-[#253968] to-slate-950 text-[#F5A623]/75">
        <i className={`fas ${icon} text-5xl`} />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {loading && <div className="absolute inset-0 z-10 bg-gray-200 animate-pulse" />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setFailed(true); }}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

const matchTabKey = (photo) => {
  const category = photo?.album?.category ?? photo?.category;
  return category ? categoryToTabKey(category) : 'general';
};

const makeFaceSearchForm = (file, type) => {
  const fd = new FormData();
  fd.append('face_image', file);
  fd.append('type', type);
  return fd;
};

// Storage hook
function useStorageUsage() {
  const [storage, setStorage] = useState({ used_bytes: 0, limit_bytes: 524288000, tier: 'free' });
  const reload = () =>
    mediaApi.storageUsage()
      .then(({ data }) => {
        const p = data?.data ?? data;
        setStorage({
          used_bytes:  p.used_bytes  ?? p.used  ?? 0,
          limit_bytes: p.limit_bytes ?? p.limit ?? 524288000,
          tier:        p.tier ?? 'free',
        });
      }).catch(() => {});
  useEffect(() => { reload(); }, []);
  return [storage, reload];
}

// ProtectedDownloadButton
function ProtectedDownloadButton({ href, label = 'Download', isPremium = false }) {
  const [showGate, setShowGate] = useState(false);

  if (!isPremium) return (
    <>
      <button onClick={() => setShowGate(true)}
        className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-400
                   bg-slate-100 px-4 py-2 rounded-xl border-none cursor-pointer">
        <i className="fas fa-lock text-[11px]" /> {label}
      </button>

      {showGate && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-black/75"
          onClick={() => setShowGate(false)}>
          <div className="bg-white rounded-[28px] p-9 max-w-[400px] w-full text-center
                          shadow-[0_40px_100px_rgba(0,0,0,0.25)]"
            onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-full bg-[#1d2b4b]/[0.07] flex items-center justify-center mx-auto mb-5">
              <i className="fas fa-shield-halved text-2xl text-[#1d2b4b]" />
            </div>
            <h3 className="font-extrabold text-lg text-[#1d2b4b] mb-2.5">Content Protected</h3>
            <p className="text-sm text-slate-500 mb-1.5 leading-relaxed">
              This document is owned by <strong>National University Lipa</strong>.
            </p>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Upgrade to <strong className="text-[#1d2b4b]">Premium</strong> or{' '}
              <strong className="text-[#1d2b4b]">Standard</strong> to download official graduation documents.
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setShowGate(false)}
                className="flex-1 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-500 cursor-pointer">
                Cancel
              </button>
              <Link to="/premium"
                className="flex-1 py-3 rounded-2xl bg-[#1d2b4b] text-[#fdb813] text-sm font-bold
                           flex items-center justify-center gap-1.5 no-underline">
                <i className="fas fa-star text-[11px]" /> Upgrade
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <a href={href} download
      className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#1d2b4b]
                 no-underline bg-[#fdb813]/15 px-4 py-2 rounded-xl hover:bg-[#fdb813]/25 transition-colors">
      <i className="fas fa-download" /> {label}
    </a>
  );
}

// CreateAlbumStep
function CreateAlbumStep({
  albums, activeAlbum, onSelect, onCreateNew, onProceed, onCancel,
  creating, newAlbumName, onNewAlbumNameChange,
}) {
  const [showNew, setShowNew] = useState(false);
  const canProceed = !!activeAlbum;

  return (
    <div className="bg-white rounded-[24px] border border-black/[0.04] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#1d2b4b] text-white text-xs font-black flex items-center justify-center">1</div>
          <p className="m-0 text-[14px] font-extrabold text-[#1d2b4b]">Select or Create an Album</p>
        </div>
        <button onClick={onCancel}
          className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 border-none cursor-pointer
                     flex items-center justify-center text-slate-400 transition-colors">
          <i className="fas fa-times text-sm" />
        </button>
      </div>

      <div className="px-6 py-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="m-0 text-[12px] font-bold text-slate-500 uppercase tracking-wide">
            <i className="fas fa-folder-open text-[#fdb813] mr-1.5" />Your Albums
          </p>
          <button onClick={() => setShowNew(v => !v)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold border-none cursor-pointer
                         px-3 py-1.5 rounded-xl transition-colors
                         ${showNew ? 'bg-slate-100 text-slate-500' : 'bg-[#1d2b4b]/[0.08] text-[#1d2b4b] hover:bg-[#1d2b4b]/[0.14]'}`}>
            <i className={`fas ${showNew ? 'fa-times' : 'fa-plus'}`} />
            {showNew ? 'Cancel' : 'New Album'}
          </button>
        </div>

        {showNew && (
          <div className="flex gap-2">
            <input type="text" value={newAlbumName} onChange={e => onNewAlbumNameChange(e.target.value)}
              placeholder="Album name…"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold
                         text-[#1d2b4b] outline-none focus:border-[#3f51b5] transition-colors"
              onKeyDown={e => e.key === 'Enter' && onCreateNew()} />
            <button onClick={onCreateNew} disabled={creating || !newAlbumName.trim()}
              className={`px-4 py-2.5 rounded-xl border-none cursor-pointer text-[13px] font-bold
                          flex items-center gap-1.5 transition-colors shrink-0
                          ${creating || !newAlbumName.trim()
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : 'bg-[#1d2b4b] text-white hover:bg-[#3f51b5]'}`}>
              {creating
                ? <><i className="fas fa-spinner animate-spin" /> Creating…</>
                : <><i className="fas fa-plus" /> Create</>}
            </button>
          </div>
        )}

        {albums.length === 0 && !showNew ? (
          <div className="text-center py-4 bg-slate-50 rounded-2xl text-[13px] text-slate-400">
            <i className="fas fa-folder mr-2 text-slate-300" />No albums yet — create one above.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {albums.map(a => {
              const active = activeAlbum === a.id;
              return (
                <button key={a.id} onClick={() => onSelect(a.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border-none cursor-pointer
                               text-[12px] font-bold transition-all
                               ${active
                                 ? 'bg-[#1d2b4b] text-white shadow-md'
                                 : 'bg-[#1d2b4b]/[0.06] text-[#1d2b4b] hover:bg-[#1d2b4b]/10'}`}>
                  <i className={`fas fa-folder text-[11px] ${active ? 'text-[#fdb813]' : 'text-slate-400'}`} />
                  {a.title}
                  {a.photos_count !== undefined && (
                    <span className={`text-[10px] ${active ? 'text-[#fdb813]' : 'text-slate-400'}`}>
                      ({a.photos_count})
                    </span>
                  )}
                  {active && <i className="fas fa-check text-[10px] text-[#fdb813] ml-0.5" />}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-1 border-t border-slate-100">
          <button onClick={onProceed} disabled={!canProceed}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-[14px] border-none
                         text-[13px] font-extrabold cursor-pointer transition-all
                         ${canProceed
                           ? 'bg-[#1d2b4b] text-white hover:bg-[#3f51b5]'
                           : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            <i className="fas fa-arrow-right text-[#fdb813]" />Continue to Upload
          </button>
        </div>
      </div>
    </div>
  );
}

// Transcript Modal
function TranscriptModal({ photoId, albumId, videoTitle, onClose }) {
  const [transcripts, setTranscripts] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [activeTab,   setActiveTab]   = useState('transcript');
  const [dlLoading,   setDlLoading]   = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (!photoId && !albumId) return;
    setLoading(true);
    setSelected(null);

    const requests = [
      photoId ? transcriptApi.list({ graduation_photo_id: photoId }) : null,
      albumId ? transcriptApi.list({ album_id: albumId }) : null,
    ].filter(Boolean);

    Promise.allSettled(requests)
      .then(results => {
        const byId = new Map();
        results.forEach(result => {
          if (result.status !== 'fulfilled') return;
          const list = result.value.data.data ?? result.value.data ?? [];
          list.forEach(item => byId.set(item.id, item));
        });
        const list = [...byId.values()];
        setTranscripts(list);
        setSelected(list[0] ?? null);
      })
      .catch(() => setTranscripts([]))
      .finally(() => setLoading(false));
  }, [photoId, albumId]);

  const handleDownload = async (id, format) => {
    setDlLoading(true);
    try {
      const res  = await transcriptApi.subtitles(id, format);
      const blob = new Blob([res.data], { type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `transcript-${id}.${format}`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert(`Failed to download ${format.toUpperCase()}.`); }
    finally { setDlLoading(false); }
  };

  const statusCfg = {
    done:       { bg: '#ecfdf5', color: '#059669', icon: 'fa-circle-check'       },
    processing: { bg: '#fefce8', color: '#ca8a04', icon: 'fa-spinner fa-spin'    },
    failed:     { bg: '#fef2f2', color: '#dc2626', icon: 'fa-circle-exclamation' },
    pending:    { bg: '#f1f5f9', color: '#64748b', icon: 'fa-clock'              },
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(8,12,24,0.85)' }}
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-[860px] sm:rounded-[28px] rounded-t-[28px]
                      flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh', boxShadow: '0 40px 100px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#fdb813]/[0.12] flex items-center justify-center">
              <i className="fas fa-file-lines text-[#fdb813]" />
            </div>
            <div>
              <h2 className="m-0 font-extrabold text-[15px] text-[#1d2b4b]">Speeches &amp; Transcripts</h2>
              {videoTitle && <p className="m-0 text-[11px] text-slate-400 mt-0.5">{videoTitle}</p>}
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 border-none cursor-pointer
                       flex items-center justify-center text-slate-400 transition-colors flex-shrink-0">
            <i className="fas fa-times" />
          </button>
        </div>

        {loading ? (
          <LoadingSkeleton variant="row" count={3} gridClassName="space-y-3" />
        ) : transcripts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-8 text-center">
            <i className="fas fa-microphone-slash text-5xl text-slate-200 block mb-4" />
            <h3 className="font-extrabold text-lg text-[#1d2b4b] mb-1">No Transcripts Yet</h3>
            <p className="text-sm text-slate-400">No speeches have been transcribed for this video.</p>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[220px] sm:w-[240px] border-r border-slate-100 overflow-y-auto flex-shrink-0 p-3 flex flex-col gap-2">
              {transcripts.map(t => {
                const s   = statusCfg[t.status] ?? statusCfg.pending;
                const act = selected?.id === t.id;
                return (
                  <button key={t.id} onClick={() => { setSelected(t); setActiveTab('transcript'); }}
                    className="text-left w-full border-none cursor-pointer rounded-[16px] p-3.5 transition-all"
                    style={{ background: act ? '#1d2b4b' : 'transparent' }}
                    onMouseEnter={e => { if (!act) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { if (!act) e.currentTarget.style.background = 'transparent'; }}>
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: act ? 'rgba(253,184,19,0.2)' : '#f1f5f9' }}>
                        <i className="fas fa-microphone-lines text-[12px]"
                          style={{ color: act ? '#fdb813' : '#94a3b8' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 font-bold text-[12px] leading-snug truncate"
                          style={{ color: act ? 'white' : '#1d2b4b' }}>{t.title}</p>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold mt-1.5 px-2 py-0.5 rounded-full"
                          style={{ background: act ? 'rgba(255,255,255,0.12)' : s.bg, color: act ? 'rgba(255,255,255,0.7)' : s.color }}>
                          <i className={`fas ${s.icon} text-[9px]`} />
                          {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {selected.status === 'done' && (
                  <div className="flex gap-1.5 px-5 pt-4 pb-0 flex-shrink-0">
                    {['transcript', 'notes'].map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className="px-4 py-2 rounded-[12px] text-[12px] font-bold border-none cursor-pointer transition-all capitalize"
                        style={{ background: activeTab === tab ? '#1d2b4b' : '#f1f5f9', color: activeTab === tab ? 'white' : '#64748b' }}>
                        {tab === 'transcript' ? 'Full Transcript' : 'AI Notes'}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {selected.status === 'done' ? (
                    activeTab === 'transcript' ? (
                      selected.transcript_text ? (
                        <div className="text-[13px] leading-relaxed text-slate-600 whitespace-pre-wrap
                                        bg-slate-50 rounded-[16px] p-5 border-l-4 border-[#fdb813]">
                          {selected.transcript_text}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">No transcript text available.</p>
                      )
                    ) : (
                      selected.notes ? (
                        <div className="text-[13px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                          {selected.notes}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">No AI notes generated yet.</p>
                      )
                    )
                  ) : selected.status === 'processing' ? (
                    <LoadingSkeleton variant="page" count={1} />
                  ) : selected.status === 'failed' ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <i className="fas fa-circle-exclamation text-3xl text-red-400" />
                      <p className="text-sm font-semibold text-slate-500">Transcription failed.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <i className="fas fa-clock text-3xl text-slate-300" />
                      <p className="text-sm text-slate-400">Queued for transcription.</p>
                    </div>
                  )}
                </div>

                {selected.status === 'done' && (
                  <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-100 flex-shrink-0 flex-wrap">
                    <button onClick={() => handleDownload(selected.id, 'srt')} disabled={dlLoading}
                      className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-xl border-none cursor-pointer transition-colors"
                      style={{ background: '#1d2b4b', color: 'white' }}>
                      <i className="fas fa-download text-[#fdb813]" /> SRT
                    </button>
                    <button onClick={() => handleDownload(selected.id, 'vtt')} disabled={dlLoading}
                      className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-xl border-none cursor-pointer transition-colors"
                      style={{ background: 'rgba(253,184,19,0.15)', color: '#1d2b4b' }}>
                      <i className="fas fa-download" /> VTT
                    </button>
                    {selected.transcript_text && (
                      <button onClick={() => navigator.clipboard.writeText(selected.transcript_text)}
                        className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-xl border-none cursor-pointer"
                        style={{ background: '#f1f5f9', color: '#475569' }}>
                        <i className="fas fa-copy" /> Copy
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Grad content cards
function GradAlbumCard({ album, onClick }) {
  return (
    <button type="button" onClick={() => onClick(album)} className="text-left w-full border-none bg-transparent p-0 block group cursor-pointer">
      <div className="rounded-3xl overflow-hidden bg-white border border-black/[0.04]
                      shadow-sm transition-all duration-300
                      group-hover:-translate-y-2 group-hover:shadow-xl">
        <div className="h-[220px] bg-gradient-to-br from-[#1d2b4b] to-[#2a3d66] relative overflow-hidden">
          <AlbumCover album={album} alt={album.title} icon="fa-images" />
          <div className="absolute bottom-3 right-3 bg-[#fdb813]/95 text-[#1d2b4b] text-[11px] font-bold px-2.5 py-1 rounded-full">
            {album.photos_count ?? 0} photos
          </div>
        </div>
        <div className="p-5">
          <h4 className="font-extrabold text-[15px] text-[#1d2b4b] mb-1.5 truncate">{album.title}</h4>
          {album.event_date && (
            <p className="text-xs text-slate-400 m-0 flex items-center gap-1.5">
              <i className="fas fa-calendar text-[#fdb813]" />
              {new Date(album.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function PhotoLightbox({ photos, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, photos.length - 1));
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [photos.length, onClose]);

  const photo = photos[idx];
  const src = imageUrl(mediaFileRef(photo));
  const title = albumMediaTitle(photo, `Photo ${idx + 1}`);
  const isVideo = isVideoMedia(photo);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border-none bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Close media preview"
      >
        <i className="fas fa-times" />
      </button>

      <span className="absolute left-1/2 top-4 -translate-x-1/2 text-xs font-bold text-white/50">
        {idx + 1} / {photos.length}
      </span>

      {idx > 0 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setIdx(i => i - 1); }}
          className="absolute left-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border-none bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Previous media"
        >
          <i className="fas fa-chevron-left" />
        </button>
      )}

      <div
        className="relative flex h-[82vh] w-[92vw] max-w-[1280px] flex-col items-center gap-3"
        onClick={e => e.stopPropagation()}
      >
        {isVideo ? (
          <video
            key={`${src}-${idx}`}
            src={src}
            controls
            autoPlay
            playsInline
            className="block h-[calc(100%-34px)] w-full rounded-2xl bg-black object-contain"
          />
        ) : (
        <ProtectedImage
          src={src}
          alt={title}
          watermarkText="© NU Lipa"
          showCopyright
          variant="lightbox"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: 'calc(100% - 34px)',
          }}
          imgStyle={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            borderRadius: 16,
          }}
        />
        )}
        {title && <p className="px-4 text-center text-sm font-semibold text-white/70">{title}</p>}
      </div>

      {idx < photos.length - 1 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setIdx(i => i + 1); }}
          className="absolute right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border-none bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Next media"
        >
          <i className="fas fa-chevron-right" />
        </button>
      )}
    </div>
  );
}

function AlbumPhotoGrid({ album, label, onBack, currentUser, onDeletePhoto }) {
  const photos = albumMediaFiles(album).filter(isApprovedMedia);
  const [lightboxIdx, setLightboxIdx] = useState(null);

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="w-fit inline-flex items-center gap-2 text-[13px] font-bold text-slate-500
                   hover:text-[#1d2b4b] border-none bg-transparent cursor-pointer transition-colors">
        <i className="fas fa-arrow-left" /> Back to all albums
      </button>

      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm px-5 py-4">
        <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-[#fdb813]">{label}</p>
        <h3 className="m-0 mt-1 text-xl font-extrabold text-[#1d2b4b]">{album?.title ?? 'Album'}</h3>
        {album?.description && <p className="m-0 mt-2 text-sm text-slate-500">{album.description}</p>}
      </div>

      {photos.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-slate-100">
          <i className="fas fa-images text-5xl text-slate-200 block mb-4" />
          <p className="text-slate-400 text-sm">No media in this album yet.</p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
          {photos.map((photo, index) => {
            const src = imageUrl(mediaFileRef(photo));
            const title = albumMediaTitle(photo, album?.title ?? `Photo ${index + 1}`);
            const isVideo = isVideoMedia(photo);
            const canDelete = Boolean(onDeletePhoto) && canDeleteMediaItem(currentUser, album, photo);
            return (
              <div
                key={photo.id ?? `${album?.id}-${index}`}
                className="group relative overflow-hidden rounded-3xl border border-slate-100 bg-white text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl"
              >
                <button
                  type="button"
                  onClick={() => setLightboxIdx(index)}
                  className="block w-full cursor-pointer border-none bg-transparent p-0 text-left"
                >
                <div className="relative h-[210px] overflow-hidden bg-slate-100">
                  {isVideo ? (
                    <>
                      <video
                        src={src}
                        muted
                        playsInline
                        preload="metadata"
                        className="block h-full w-full bg-black object-cover"
                      />
                      <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-xl bg-black/65 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
                        <i className="fas fa-play text-[#fdb813]" /> Video
                      </div>
                    </>
                  ) : (
                  <ProtectedImage
                    src={src}
                    alt={title}
                    watermarkText="© NU Lipa"
                    showCopyright
                    style={{ width: '100%', height: '100%' }}
                    imgStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                      <i className={`fas ${isVideo ? 'fa-play' : 'fa-expand'} text-base text-white`} />
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <p className="m-0 text-sm font-extrabold text-[#1d2b4b] truncate">{title}</p>
                  {photo?.caption && photo.caption !== title && (
                    <p className="m-0 mt-1 text-[12px] text-slate-400 line-clamp-2">{photo.caption}</p>
                  )}
                </div>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDeletePhoto?.(photo)}
                    className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-xl border-none bg-red-500/95 px-3 py-1.5 text-[11px] font-extrabold text-white shadow-lg transition-colors hover:bg-red-600"
                  >
                    <i className="fas fa-trash" /> Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {lightboxIdx !== null && (
          <PhotoLightbox
            photos={photos}
            startIndex={lightboxIdx}
            onClose={() => setLightboxIdx(null)}
          />
        )}
        </>
      )}
    </div>
  );
}

// VideoAlbumCard
function VideoAlbumCard({ album, onClick }) {
  const videoCount = albumMediaCount(album);

  return (
    <button onClick={() => onClick(album)}
      className="text-left w-full border-none bg-white rounded-3xl overflow-hidden
                 shadow-sm border border-black/[0.04] cursor-pointer group
                 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl">
      <div className="h-[200px] bg-gradient-to-br from-[#0d1b35] to-[#1d2b4b] relative overflow-hidden
                      flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-[#fdb813] flex items-center justify-center
                        shadow-lg group-hover:scale-110 transition-transform duration-300">
          <i className="fas fa-play text-2xl text-[#1d2b4b] ml-1" />
        </div>
        <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white
                        text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
          <i className="fas fa-film text-[#fdb813] text-[10px]" />
          {videoCount} {videoCount === 1 ? 'video' : 'videos'}
        </div>
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fdb813 0, #fdb813 1px, transparent 0, transparent 50%)', backgroundSize: '12px 12px' }} />
      </div>
      <div className="p-5">
        <h4 className="font-extrabold text-[15px] text-[#1d2b4b] mb-1.5 truncate">{album.title}</h4>
        {album.event_date && (
          <p className="text-xs text-slate-400 m-0 flex items-center gap-1.5">
            <i className="fas fa-calendar text-[#fdb813]" />
            {new Date(album.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
        <p className="mt-2 text-[11px] font-bold text-[#3f51b5] flex items-center gap-1">
          <i className="fas fa-arrow-right text-[10px]" /> View Videos
        </p>
      </div>
    </button>
  );
}

// GradVideoCard
function GradVideoCard({ video, photoId, albumId, albumTitle, badge, onOpen }) {
  const [playing,        setPlaying]        = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const src   = video.file_path ?? video.media_url;
  const title = video.title ?? video.caption ?? albumTitle ?? 'Video';
  const date  = video.event_date ?? null;

  return (
    <>
      <div className="rounded-3xl overflow-hidden bg-white border border-black/[0.04] shadow-sm">
        <div className="bg-[#0a0f1e]">
          {playing ? (
            <video src={src} controls autoPlay className="w-full max-h-[240px] block" />
          ) : (
            <div onClick={onOpen ?? (() => setPlaying(true))}
              className="h-[200px] bg-gradient-to-br from-[#0d1b35] to-[#1d2b4b] flex items-center justify-center cursor-pointer relative">
              {badge && (
                <span className="absolute top-3 left-3 bg-[#fdb813]/95 text-[#1d2b4b] text-[10px] font-extrabold px-2.5 py-1 rounded-xl">
                  {badge}
                </span>
              )}
              <div className="w-14 h-14 rounded-full bg-[#fdb813] flex items-center justify-center shadow-lg">
                <i className="fas fa-play text-xl text-[#1d2b4b] ml-0.5" />
              </div>
            </div>
          )}
        </div>
        <div className="p-5">
          <h4 className="font-extrabold text-[15px] text-[#1d2b4b] mb-1.5">{title}</h4>
          {date && (
            <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
              <i className="fas fa-calendar text-[#fdb813]" />
              {new Date(date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
          <button onClick={() => setShowTranscript(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#3f51b5]
                       bg-[#3f51b5]/[0.08] px-2.5 py-1 rounded-lg hover:bg-[#3f51b5]/[0.15] transition-colors border-none cursor-pointer">
            <i className="fas fa-file-lines" /> View Transcript
          </button>
        </div>
      </div>

      {showTranscript && (
        <TranscriptModal
          photoId={photoId}
          albumId={albumId ?? video.graduation_album_id ?? video.album_id}
          videoTitle={title}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </>
  );
}

function VideoLightbox({ videos, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  const [showTranscript, setShowTranscript] = useState(false);
  const current = videos[idx];
  const video = current?.video ?? {};
  const src = video.file_path ?? video.media_url ?? video.url ?? '';
  const title = video.title ?? video.caption ?? current?.albumTitle ?? `Video ${idx + 1}`;

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') {
        setShowTranscript(false);
        setIdx(i => Math.min(i + 1, videos.length - 1));
      }
      if (e.key === 'ArrowLeft') {
        setShowTranscript(false);
        setIdx(i => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [videos.length, onClose]);

  if (!current) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border-none bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Close video preview"
        >
          <i className="fas fa-times" />
        </button>

        <span className="absolute left-1/2 top-4 -translate-x-1/2 text-xs font-bold text-white/50">
          {idx + 1} / {videos.length}
        </span>

        {idx > 0 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setShowTranscript(false); setIdx(i => i - 1); }}
            className="absolute left-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border-none bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Previous video"
          >
            <i className="fas fa-chevron-left" />
          </button>
        )}

        <div
          className="flex h-[82vh] w-[92vw] max-w-[1280px] flex-col overflow-hidden rounded-[24px] bg-[#0b1224] shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-[#1d2b4b] px-5 py-4">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-[#fdb813]">
                {current.badge ?? 'Video'}
              </p>
              <h3 className="m-0 mt-1 truncate text-base font-extrabold text-white sm:text-lg">{title}</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowTranscript(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border-none bg-white/10 px-3.5 py-2 text-[12px] font-bold text-white transition-colors hover:bg-white/20"
            >
              <i className="fas fa-file-lines text-[#fdb813]" /> Transcript
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
            {src ? (
              <video
                key={`${src}-${idx}`}
                src={src}
                controls
                autoPlay
                className="block h-full w-full bg-black object-contain"
              />
            ) : (
              <div className="py-20 text-sm font-semibold text-white/50">Video file is unavailable.</div>
            )}
          </div>
        </div>

        {idx < videos.length - 1 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setShowTranscript(false); setIdx(i => i + 1); }}
            className="absolute right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border-none bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Next video"
          >
            <i className="fas fa-chevron-right" />
          </button>
        )}
      </div>

      {showTranscript && (
        <TranscriptModal
          photoId={current.photoId}
          albumId={current.albumId ?? video.graduation_album_id ?? video.album_id}
          videoTitle={title}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </>
  );
}

function GraduationMediaPreviewModal({ open, album, mediaUrl, onClose }) {
  const title = album?.title ?? 'Graduation Content';
  const isImage = isImageMedia(mediaUrl);
  const isPdf = /\.pdf(\?|$)/i.test(String(mediaUrl));
  const [pdfSrc, setPdfSrc] = useState('');

  useEffect(() => {
    if (!open || !isPdf || !mediaUrl) {
      setPdfSrc('');
      return undefined;
    }

    let cancelled = false;
    let objectUrl = '';
    const viewerUrl = `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(mediaUrl)}`;
    setPdfSrc(viewerUrl);

    fetch(mediaUrl)
      .then(response => {
        if (!response.ok) throw new Error('PDF fetch failed');
        return response.blob();
      })
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPdfSrc(viewerUrl);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, isPdf, mediaUrl]);

  if (!open || !mediaUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-[#071024]/90 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-[980px] max-h-[92vh] bg-white rounded-[24px] overflow-hidden shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100 bg-[#1d2b4b]">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-[#fdb813]">Preview</p>
            <h3 className="m-0 mt-1 text-base sm:text-lg font-extrabold text-white truncate">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer"
            aria-label="Close preview"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="bg-[#0b1224] flex-1 min-h-[320px] max-h-[74vh] overflow-auto flex items-center justify-center p-4">
          {isImage ? (
            <ProtectedImage
              src={mediaUrl}
              alt={title}
              watermarkText="© NU Lipa"
              showCopyright
              style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              imgStyle={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 14 }}
            />
          ) : isPdf ? (
            <iframe
              src={pdfSrc || `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(mediaUrl)}`}
              title={title}
              className="w-full h-[72vh] rounded-xl bg-white border-0"
            />
          ) : (
            <div className="text-center text-white/70 py-16">
              <i className="fas fa-file text-5xl text-[#fdb813] mb-4 block" />
              <p className="font-bold m-0">Preview is not available for this file type.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GradProgramCard({ album, isPremium = false }) {
  const mediaUrl = primaryAlbumMedia(album);
  const imageProgram = isImageMedia(mediaUrl);
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
    <div className="rounded-3xl overflow-hidden bg-white border border-black/[0.04] shadow-sm
                    hover:-translate-y-1.5 hover:shadow-xl transition-all duration-300">
      <div className="h-[240px] bg-gradient-to-br from-[#1d2b4b] to-[#2a3d66] flex items-center justify-center overflow-hidden">
      {imageProgram ? (
        <div className="w-full h-full overflow-hidden bg-[#1d2b4b]">
          <ProtectedImage
            src={mediaUrl}
            alt={album.title}
            watermarkText="© NU Lipa"
            showCopyright
            style={{ width: '100%', height: '100%' }}
            imgStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5">
          <i className="fas fa-file-pdf text-5xl text-[#fdb813]/70" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">Program PDF</span>
        </div>
      )}
      </div>
      <div className="p-5">
        <h4 className="font-extrabold text-[15px] text-[#1d2b4b] mb-1.5">{album.title}</h4>
        {album.event_date && (
          <p className="text-xs text-slate-400 mb-2.5 flex items-center gap-1.5">
            <i className="fas fa-calendar text-[#fdb813]" />
            {new Date(album.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
        {album.description && <p className="text-sm text-slate-500 mb-2.5 line-clamp-2">{album.description}</p>}
        <p className="text-[11px] text-slate-400 mb-2.5 flex items-center gap-1">
          <i className="fas fa-copyright text-[#fdb813] text-[10px]" />
          Property of National University Lipa
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white border-none
                       bg-[#1d2b4b] px-3.5 py-2 rounded-xl hover:bg-[#3f51b5] transition-colors cursor-pointer">
            <i className="fas fa-eye" /> View
          </button>
          <ProtectedDownloadButton href={mediaUrl} label="Download" isPremium={isPremium} />
        </div>
      </div>
    </div>
    <GraduationMediaPreviewModal open={previewOpen} album={album} mediaUrl={mediaUrl} onClose={() => setPreviewOpen(false)} />
    </>
  );
}

function GradInvitationCard({ album, isPremium = false }) {
  const mediaUrl = primaryAlbumMedia(album);
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
    <div className="rounded-3xl overflow-hidden bg-white border border-black/[0.04] shadow-sm
                    hover:-translate-y-1.5 hover:shadow-xl transition-all duration-300">
      <div className="h-[240px] bg-gradient-to-br from-[#1d2b4b] to-[#2a3d66] flex items-center justify-center overflow-hidden">
        {mediaUrl?.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
          ? <ProtectedImage src={mediaUrl} alt={album.title} watermarkText="© NU Lipa"
              showCopyright style={{ width: '100%', height: '100%' }}
              imgStyle={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div className="flex flex-col items-center gap-2.5">
              <i className="fas fa-envelope-open-text text-5xl text-[#fdb813]/60" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Digital Invitation</span>
            </div>
        }
      </div>
      <div className="p-5">
        <h4 className="font-extrabold text-[15px] text-[#1d2b4b] mb-1.5">{album.title}</h4>
        <p className="text-[11px] text-slate-400 mb-2.5 flex items-center gap-1">
          <i className="fas fa-copyright text-[#fdb813] text-[10px]" />
          Property of National University Lipa
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white border-none
                       bg-[#1d2b4b] px-3.5 py-2 rounded-xl hover:bg-[#3f51b5] transition-colors cursor-pointer">
            <i className="fas fa-eye" /> View
          </button>
          <ProtectedDownloadButton href={mediaUrl} label="Save" isPremium={isPremium} />
        </div>
      </div>
    </div>
    <GraduationMediaPreviewModal open={previewOpen} album={album} mediaUrl={mediaUrl} onClose={() => setPreviewOpen(false)} />
    </>
  );
}

function GradSongCard({ album }) {
  const mediaUrl = primaryAlbumMedia(album);
  const firstMedia = albumMediaFiles(album)[0];
  const mediaRef = useRef(null);
  const [playing,        setPlaying]        = useState(false);
  const [current,        setCurrent]        = useState(0);
  const [duration,       setDur]            = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);

  const isVideo = /\.(mp4|mov|webm|mkv)(\?|$)/i.test(mediaUrl ?? '');
  const fmt = s => !s || isNaN(s) ? '0:00' : `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  const toggle = () => {
    if (!mediaRef.current) return;
    playing ? mediaRef.current.pause() : mediaRef.current.play();
    setPlaying(!playing);
  };

  return (
    <>
      <div className="rounded-3xl bg-white overflow-hidden border border-black/[0.04] shadow-sm">
        {isVideo ? (
          <div className="bg-[#0a0f1e] relative">
            <video ref={mediaRef} src={mediaUrl}
              className="w-full max-h-[220px] block bg-black"
              onTimeUpdate={() => setCurrent(mediaRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setDur(mediaRef.current?.duration ?? 0)}
              onEnded={() => setPlaying(false)} />
            {!playing && (
              <div onClick={toggle}
                className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/35">
                <div className="w-[52px] h-[52px] rounded-full bg-[#fdb813] flex items-center justify-center">
                  <i className="fas fa-play text-lg text-[#1d2b4b] ml-0.5" />
                </div>
              </div>
            )}
            <span className="absolute top-2.5 left-2.5 bg-[#1d2b4b]/80 text-[#fdb813] text-[10px] font-extrabold px-2.5 py-1 rounded-lg backdrop-blur-sm">
              <i className="fas fa-film mr-1" />VIDEO
            </span>
          </div>
        ) : (
          <div className="h-[130px] bg-gradient-to-br from-[#1d2b4b] to-[#2a3d66] flex items-center justify-center relative overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <div key={i}
                className={`absolute w-[3px] rounded-sm transition-colors duration-300 ${playing ? 'bg-[#fdb813]' : 'bg-[#fdb813]/25'}`}
                style={{ height: `${20 + Math.sin(i * 0.8) * 32}px`, left: `${4 + i * 4.8}%` }} />
            ))}
            <button onClick={toggle}
              className="relative z-10 w-[52px] h-[52px] rounded-full bg-[#fdb813] border-none cursor-pointer
                         flex items-center justify-center hover:scale-110 transition-transform">
              <i className={`fas ${playing ? 'fa-pause' : 'fa-play'} text-base text-[#1d2b4b]`}
                style={{ marginLeft: playing ? 0 : 3 }} />
            </button>
            <span className="absolute top-2.5 left-2.5 bg-[#fdb813]/20 text-[#fdb813] text-[10px] font-extrabold px-2.5 py-1 rounded-lg">
              <i className="fas fa-music mr-1" />AUDIO
            </span>
            <audio ref={mediaRef} src={mediaUrl}
              onTimeUpdate={() => setCurrent(mediaRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setDur(mediaRef.current?.duration ?? 0)}
              onEnded={() => setPlaying(false)} />
          </div>
        )}
        <div className="p-5">
          <h4 className="font-extrabold text-[15px] text-[#1d2b4b] mb-2.5">{album.title}</h4>
          <div className="h-1.5 bg-slate-200 rounded-full cursor-pointer mb-1.5"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect();
              if (mediaRef.current) mediaRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
            }}>
            <div className="h-full bg-[#fdb813] rounded-full transition-[width] duration-100"
              style={{ width: `${duration ? (current / duration) * 100 : 0}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 mb-3">
            <span>{fmt(current)}</span><span>{fmt(duration)}</span>
          </div>
          <button onClick={() => setShowTranscript(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#3f51b5]
                       bg-[#3f51b5]/[0.08] px-2.5 py-1 rounded-lg hover:bg-[#3f51b5]/[0.15] transition-colors border-none cursor-pointer">
            <i className="fas fa-file-lines" /> View Transcript
          </button>
        </div>
      </div>

      {showTranscript && (
        <TranscriptModal
          photoId={firstMedia?.id}
          albumId={album.id}
          videoTitle={album.title}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </>
  );
}

// Face Search Results
function FaceSearchResults({ matches, isGrad, onOpenAlbum }) {
  if (!matches.length) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
      {matches.map(p => {
        const title = p.album?.title || p.caption || 'Matched Photo';

        return (
          <button key={`${p.source_type ?? 'gallery'}-${p.photo_id ?? p.id}`}
            type="button"
            onClick={() => p.album_id && onOpenAlbum?.(p.album ?? { id: p.album_id, title }, isGrad ? 'graduation:photos' : 'general')}
            className="text-left block rounded-[18px] overflow-hidden border border-slate-200 bg-white
                       hover:border-[#fdb813] hover:-translate-y-1 transition-all group shadow-sm cursor-pointer p-0">
            <div className="relative">
              <img src={p.file_path} alt={title} className="w-full h-40 object-cover" />
            </div>
            <div className="px-4 py-3">
              <p className="m-0 text-sm font-extrabold text-[#1d2b4b] truncate">
                <i className="fas fa-images mr-1.5 text-[#fdb813]" />{title}
              </p>
              <p className="m-0 mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {isGrad ? 'Graduation Match' : 'Gallery Match'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Main Page
export default function GalleryPage() {
  const { user } = useAuth();
  const userTier  = getTier(user);
  const isPremium = userTier === 'premium' || userTier === 'standard';
  const isFree    = userTier === 'free';
  const canUpload = user?.role === 'admin' || user?.is_admin || isPremium;

  const [activeTab,     setActiveTab]     = useState('general');
  const [albums,        setAlbums]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [searching,     setSearching]     = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [matches,       setMatches]       = useState([]);
  const [uploadStep,    setUploadStep]    = useState(null);
  const [activeAlbum,   setActiveAlbum]   = useState(null);
  const [storage,       reloadStorage]    = useStorageUsage();
  const [newAlbumName,  setNewAlbumName]  = useState('');
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [selectedVideoAlbum, setSelectedVideoAlbum] = useState(null);
  const [selectedGalleryAlbum, setSelectedGalleryAlbum] = useState(null);
  const [selectedGradAlbum, setSelectedGradAlbum] = useState(null);
  const [videoLightboxIdx, setVideoLightboxIdx] = useState(null);
  const [uploadVisibility, setUploadVisibility] = useState('public');
  const [deletePhotoTarget, setDeletePhotoTarget] = useState(null);
  const [deletePhotoLoading, setDeletePhotoLoading] = useState(false);

  const isGrad = activeTab !== 'general';
  const tier   = storage.tier;

  const uploadHook = useMediaUpload(activeAlbum, tier, () => {
    setUploadStep(null);
    loadAlbums();
    reloadStorage();
  });

  const bulkUploadProps = {
    queue:       uploadHook.files,
    uploading:   uploadHook.uploading,
    progress:    uploadHook.progress,
    errors:      uploadHook.error ? [uploadHook.error] : [],
    isDragging:  uploadHook.isDragging,
    limits: {
      videoAllowed: uploadHook.tier.maxVideoSizeMB > 0,
      maxFiles:     uploadHook.tier.maxFiles,
      maxPhotoMB:   uploadHook.tier.maxFileSizeMB,
      maxVideoMB:   uploadHook.tier.maxVideoSizeMB,
    },
    addFiles:     uploadHook.addFiles,
    removeFile:   uploadHook.removeFile,
    clearQueue:   uploadHook.clearFiles,
    upload:       () => uploadHook.submit({ visibility: uploadVisibility }),
    dragHandlers: uploadHook.dragProps,
  };

  const hydrateAlbumCovers = async (list, tab) => {
    const albumsToHydrate = list.filter(albumNeedsCoverHydration);
    if (!albumsToHydrate.length) return list;

    const api = tab === 'general' ? galleryApi : graduationApi;
    const hydrated = await Promise.all(albumsToHydrate.map(album =>
      api.show(album.id)
        .then(({ data }) => ({ id: album.id, detail: data.data ?? data ?? {} }))
        .catch(() => ({ id: album.id, detail: null }))
    ));
    const detailMap = new Map(hydrated.filter(item => item.detail).map(item => [item.id, item.detail]));

    return list.map(album => {
      const detail = detailMap.get(album.id);
      return detail ? { ...album, ...detail } : album;
    });
  };

  const fetchAlbumsForTab = async (tab) => {
    if (tab === 'general') {
      const { data } = await galleryApi.list('general', null);
      return data.data ?? data ?? [];
    }

    if (tab === 'graduation:program') {
      const [programs, invitations] = await Promise.all([
        graduationApi.list('program').then(({ data }) => (data.data ?? data ?? []).map(album => ({ ...album, __programSection: 'Program' }))).catch(() => []),
        graduationApi.list('invitations').then(({ data }) => (data.data ?? data ?? []).map(album => ({ ...album, __programSection: 'Invitation' }))).catch(() => []),
      ]);
      return [...programs, ...invitations];
    }

    const { data } = await graduationApi.list(apiCategoryForTab(tab));
    return data.data ?? data ?? [];
  };

  const loadAlbums = (tab = activeTab) => {
    setLoading(true);
    fetchAlbumsForTab(tab)
      .then(async list => {
        setAlbums(await hydrateAlbumCovers(list, tab));
      })
      .catch(() => setAlbums([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAlbums(activeTab); }, [activeTab]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    Promise.all(TABS.map(tab => {
      return fetchAlbumsForTab(tab.key)
        .then(list => list.map(album => ({ album, tab })))
        .catch(() => []);
    }))
      .then(groups => {
        if (cancelled) return;
        setSearchResults(
          groups.flat().filter(({ album, tab }) => albumSearchHaystack(album, tab).includes(q))
        );
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => { cancelled = true; };
  }, [searchQuery]);

  const handleTabChange = (key) => {
    setActiveTab(key);
    setUploadStep(null);
    setMatches([]);
    setSearchQuery('');
    setSearchResults([]);
    setActiveAlbum(null);
    setNewAlbumName('');
    setSelectedVideoAlbum(null);
    setVideoLightboxIdx(null);
    setSelectedGalleryAlbum(null);
    setSelectedGradAlbum(null);
    setDeletePhotoTarget(null);
  };

  const openInlineAlbum = async (album, tab = activeTab) => {
    setUploadStep(null);
    setMatches([]);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedVideoAlbum(null);
    setVideoLightboxIdx(null);

    const isGeneral = tab === 'general';
    if (tab !== activeTab) setActiveTab(tab);

    const fallback = { ...album };
    isGeneral ? setSelectedGalleryAlbum(fallback) : setSelectedGradAlbum(fallback);

    const api = isGeneral ? galleryApi : graduationApi;
    try {
      const { data } = await api.show(album.id);
      const detail = data.data ?? data ?? {};
      const merged = { ...fallback, ...detail };
      isGeneral ? setSelectedGalleryAlbum(merged) : setSelectedGradAlbum(merged);
    } catch {
      // Keep the album card payload visible if the detail request fails.
    }
  };

  const closeInlineAlbum = () => {
    setSelectedGalleryAlbum(null);
    setSelectedGradAlbum(null);
    setVideoLightboxIdx(null);
    setDeletePhotoTarget(null);
  };

  const requestDeleteOwnedGalleryPhoto = (photo) => {
    if (!canDeleteMediaItem(user, selectedGalleryAlbum, photo)) return;
    setDeletePhotoTarget(photo);
  };

  const confirmDeleteOwnedGalleryPhoto = async () => {
    const photo = deletePhotoTarget;
    if (!canDeleteMediaItem(user, selectedGalleryAlbum, photo)) {
      setDeletePhotoTarget(null);
      return;
    }

    const id = photo?.media_id ?? photo?.mediaId ?? photo?.id;
    if (!id) return;

    setDeletePhotoLoading(true);
    try {
      await mediaApi.deletePhoto(id);
      setSelectedGalleryAlbum(current => {
        if (!current) return current;
        const filterMedia = item => (
          item?.id !== photo?.id &&
          item?.media_id !== photo?.media_id &&
          item?.media_id !== id &&
          item?.id !== id
        );

        return {
          ...current,
          photos: Array.isArray(current.photos) ? current.photos.filter(filterMedia) : current.photos,
          media_files: Array.isArray(current.media_files) ? current.media_files.filter(filterMedia) : current.media_files,
          mediaFiles: Array.isArray(current.mediaFiles) ? current.mediaFiles.filter(filterMedia) : current.mediaFiles,
          media: Array.isArray(current.media) ? current.media.filter(filterMedia) : current.media,
        };
      });
      setDeletePhotoTarget(null);
      loadAlbums();
    } catch {
      window.alert('Unable to delete this photo.');
    } finally {
      setDeletePhotoLoading(false);
    }
  };

  // FIX: replaced raw fetch() + safeGetToken() with galleryApi.createAlbum()
  //         so the axios interceptor handles the Authorization header correctly.
  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    setCreatingAlbum(true);
    try {
      const { data } = await galleryApi.createAlbum({
        title: newAlbumName.trim(),
        type:  'general',
      });

      const newId = data?.data?.id ?? data?.id;

      // Refresh the album list and auto-select the newly created album.
      const { data: listData } = await galleryApi.list('general', null);
      setAlbums(listData.data ?? listData ?? []);
      setActiveAlbum(newId);
      setNewAlbumName('');
    } catch (e) {
      alert(e?.response?.data?.message ?? e.message ?? 'Album creation failed.');
    } finally {
      setCreatingAlbum(false);
    }
  };

  const handleFaceFile = async (file) => {
    setSearching(true);
    setMatches([]);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedVideoAlbum(null);
    setVideoLightboxIdx(null);
    setSelectedGalleryAlbum(null);
    setSelectedGradAlbum(null);
    try {
      const responses = await Promise.allSettled([
        galleryApi.faceSearch(makeFaceSearchForm(file, 'general')),
        galleryApi.faceSearch(makeFaceSearchForm(file, 'graduation')),
      ]);

      const photos = responses
        .flatMap((result, index) => {
          if (result.status !== 'fulfilled') return [];
          const source = index === 0 ? 'general' : 'graduation';
          return (result.value.data.photos ?? []).map(photo => ({ ...photo, source_type: source }));
        })
        .sort((a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0));

      setMatches(photos);

      if (!photos.length) {
        alert('No matching media found.');
        return;
      }

      const targetTab = matchTabKey(photos[0]);
      if (targetTab !== activeTab) {
        setActiveTab(targetTab);
      }
    } catch (err) {
      alert(err?.response?.data?.message || 'Face search failed.');
    } finally {
      setSearching(false);
    }
  };

  const cancelUpload = () => {
    setUploadStep(null);
    setActiveAlbum(null);
    setNewAlbumName('');
    setUploadVisibility('public');
    uploadHook.clearFiles();
  };

  const openUploadFromCard = (albumId) => {
    setActiveAlbum(albumId);
    setUploadVisibility('public');
    setSelectedGalleryAlbum(null);
    setSelectedGradAlbum(null);
    setVideoLightboxIdx(null);
    setUploadStep('upload');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const flattenVideosFromAlbum = (album, badge = undefined) => {
    const vids = albumMediaFiles(album);
    if (vids.length > 0) {
      return vids.map(v => ({
        video:      v,
        photoId:    v.id,
        albumId:    album.id,
        albumTitle: album.title,
        badge,
      }));
    }
    return [{
      video:      { ...album, file_path: primaryAlbumMedia(album) },
      photoId:    album.id,
      albumId:    album.id,
      albumTitle: album.title,
      badge,
    }];
  };

  const isVideoTab     = activeTab === 'graduation:videos' || activeTab === 'graduation:mass';
  const videoTabBadge  = activeTab === 'graduation:mass' ? 'Baccalaureate Mass' : undefined;
  const photoGradTabs  = ['graduation:photos'];
  const primaryTabs    = TABS.slice(0, 4);
  const secondaryTabs  = TABS.slice(4);
  const hasGallerySearch = searchQuery.trim().length > 0;
  const visibleFaceMatches = matches.filter(photo => matchTabKey(photo) === activeTab);
  const hasFaceMatches = visibleFaceMatches.length > 0;

  const tabCls = (key, sm = false) =>
    `flex items-center justify-center gap-1.5 font-bold border-none cursor-pointer transition-all rounded-[14px]
     ${sm ? 'py-2 px-1.5 text-[11px]' : 'py-2.5 px-2 text-[12px]'}
     ${activeTab === key ? 'bg-[#1d2b4b] text-white' : 'bg-transparent text-slate-400 hover:text-slate-600'}`;

  const heroTitle = isGrad
    ? <><span className="text-[#fdb813]">Graduation</span> Hub</>
    : <>The <span className="text-[#fdb813]">Visual Archive</span></>;
  const heroSubtitle = isGrad
    ? 'Photos, videos, programs, ceremonies, and memories — all in one place.'
    : 'Relive the milestones and pioneer memories through our AI-powered digital gallery.';
  const heroLabel = isGrad ? 'Class Milestones' : 'National University Lipa';

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7fe] font-sans">
      <Navbar />

      {/* Hero */}
      <header className="min-h-[140px] bg-gradient-to-br from-[#1d2b4b] to-[#2a3d66] px-[8%] py-8 text-center text-white rounded-b-[28px]">
        <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-white/50 mb-2.5">{heroLabel}</p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">{heroTitle}</h1>
        <p className="text-sm text-white/70 max-w-[520px] mx-auto mb-4 leading-relaxed font-light">
          {heroSubtitle}
        </p>

        {!isGrad && (
          <div className="max-w-[520px] mx-auto mb-7">
            <ContentOwnershipBanner message="All media in this gallery is the exclusive property of" />
          </div>
        )}

        <div className="max-w-[560px] mx-auto relative z-10">
          <div className="relative">
            <i className="fas fa-search absolute left-[18px] top-1/2 -translate-y-1/2 text-[#fdb813] text-[15px] z-[1] pointer-events-none" />
            <input type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setMatches([]);
              }}
              placeholder={searching ? 'Searching...' : 'Search gallery, videos, programs, invitations...'}
              className="w-full h-11 pl-[46px] pr-14 border border-white/15 rounded-xl outline-none
                         bg-white/10 backdrop-blur-xl text-white text-sm font-medium
                         focus:bg-white/[0.18] focus:border-[#fdb813]/60 transition-all placeholder-white/50" />
            <FaceSearchButton onFile={handleFaceFile} loading={searching} />
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-[1000px] mx-auto -mt-4 px-5 w-full relative z-10">
        <div className="bg-white flex gap-1 p-1.5 rounded-t-[20px] shadow-sm border-b border-slate-100">
          {primaryTabs.map(tab => (
            tab.href ? (
              <Link key={tab.key} to={tab.href} className={`flex-1 min-w-[60px] no-underline ${tabCls(tab.key)}`}>
                <i className={`fas ${tab.icon} text-[11px]`} />
                {tab.label}
              </Link>
            ) : (
            <button key={tab.key} onClick={() => handleTabChange(tab.key)} className={`flex-1 min-w-[60px] ${tabCls(tab.key)}`}>
              <i className={`fas ${tab.icon} ${activeTab === tab.key ? 'text-[#fdb813]' : ''} text-[11px]`} />
              {tab.label}
            </button>
            )
          ))}
        </div>
        <div className="bg-white flex gap-1 p-1.5 rounded-b-[20px] shadow-xl shadow-[#1d2b4b]/10">
          {secondaryTabs.map(tab => (
            tab.href ? (
              <Link key={tab.key} to={tab.href} className={`flex-1 min-w-[60px] no-underline ${tabCls(tab.key, true)}`}>
                <i className={`fas ${tab.icon} text-[11px]`} />
                {tab.label}
              </Link>
            ) : (
            <button key={tab.key} onClick={() => handleTabChange(tab.key)} className={`flex-1 min-w-[60px] ${tabCls(tab.key, true)}`}>
              <i className={`fas ${tab.icon} ${activeTab === tab.key ? 'text-[#fdb813]' : ''} text-[11px]`} />
              {tab.label}
            </button>
            )
          ))}
        </div>
      </div>

      {/* Storage bar */}
      {activeTab === 'general' && !isFree && (
        <div className="max-w-[1000px] mx-auto mt-4 px-5 w-full">
          <StorageUsageBar
            usedBytes={storage.used_bytes}
            limitBytes={storage.limit_bytes}
            tier={tier}
            onUpgrade={() => window.location.href = '/premium'}
          />
        </div>
      )}

      {/* Upload flow */}
      {!isGrad && uploadStep && (
        <div className="max-w-[1000px] mx-auto mt-5 px-5 w-full flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {['Select Album', 'Upload Media'].map((label, i) => {
              const stepKey  = i === 0 ? 'album' : 'upload';
              const isDone   = uploadStep === 'upload' && i === 0;
              const isActive = uploadStep === stepKey;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black
                    ${isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-[#1d2b4b] text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {isDone ? <i className="fas fa-check" /> : i + 1}
                  </div>
                  <span className={`text-[12px] font-bold ${isActive ? 'text-[#1d2b4b]' : 'text-slate-400'}`}>{label}</span>
                  {i === 0 && <i className="fas fa-chevron-right text-slate-300 text-[10px]" />}
                </div>
              );
            })}
          </div>

          {uploadStep === 'album' && (
            <CreateAlbumStep
              albums={albums} activeAlbum={activeAlbum} onSelect={setActiveAlbum}
              onCreateNew={handleCreateAlbum} onProceed={() => setUploadStep('upload')}
              onCancel={cancelUpload} creating={creatingAlbum}
              newAlbumName={newAlbumName} onNewAlbumNameChange={setNewAlbumName}
            />
          )}

          {uploadStep === 'upload' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 bg-[#1d2b4b]/[0.08] px-3.5 py-2 rounded-xl">
                  <i className="fas fa-folder text-[#fdb813] text-[13px]" />
                  <span className="text-[13px] font-extrabold text-[#1d2b4b]">
                    {albums.find(a => a.id === activeAlbum)?.title ?? 'Selected Album'}
                  </span>
                </div>
                <button onClick={() => setUploadStep('album')}
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-400
                             hover:text-[#1d2b4b] border-none bg-transparent cursor-pointer transition-colors">
                  <i className="fas fa-arrow-left" /> Change Album
                </button>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
                <p className="m-0 mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Visibility</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {VISIBILITY_OPTIONS.map(option => {
                    const selected = uploadVisibility === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setUploadVisibility(option.value)}
                        className={`text-left rounded-xl border px-3 py-2.5 transition-all cursor-pointer bg-white
                          ${selected ? 'border-[#1d2b4b] ring-2 ring-[#fdb813]/30' : 'border-slate-200 hover:border-[#fdb813]/70'}`}
                      >
                        <span className="flex items-center gap-2 text-[13px] font-extrabold text-[#1d2b4b]">
                          <i className={`fas ${option.icon} ${selected ? 'text-[#fdb813]' : 'text-slate-400'}`} />
                          {option.label}
                        </span>
                        <span className="block mt-1 text-[11px] font-semibold text-slate-400">{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <BulkUploadZone {...bulkUploadProps} tier={tier} onCancel={cancelUpload} />
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <section className="px-[8%] pt-8 pb-24 flex-1">
        <div className="flex items-center justify-between mb-7">
          <h2 className="text-xl font-extrabold text-[#1d2b4b] m-0 flex items-center gap-2">
            {(selectedGalleryAlbum || selectedGradAlbum) ? (
              <>
                <button onClick={closeInlineAlbum}
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#1d2b4b]
                             border-none bg-transparent cursor-pointer text-xl font-extrabold transition-colors p-0">
                  <i className="fas fa-chevron-left text-base" />
                  {TABS.find(t => t.key === activeTab)?.label}
                </button>
                <i className="fas fa-chevron-right text-slate-300 text-sm" />
                <span className="text-[#1d2b4b]">{(selectedGalleryAlbum || selectedGradAlbum)?.title}</span>
              </>
            ) : isVideoTab && selectedVideoAlbum ? (
              <>
                <button onClick={() => setSelectedVideoAlbum(null)}
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#1d2b4b]
                             border-none bg-transparent cursor-pointer text-xl font-extrabold transition-colors p-0">
                  <i className="fas fa-chevron-left text-base" />
                  {TABS.find(t => t.key === activeTab)?.label}
                </button>
                <i className="fas fa-chevron-right text-slate-300 text-sm" />
                <span className="text-[#1d2b4b]">{selectedVideoAlbum.title}</span>
              </>
            ) : hasGallerySearch ? (
              `Search Results for "${searchQuery.trim()}"`
            ) : hasFaceMatches ? (
              `Face Matches in ${TABS.find(t => t.key === activeTab)?.label ?? 'Gallery'}`
            ) : (
              TABS.find(t => t.key === activeTab)?.label ?? 'Albums'
            )}
          </h2>

          {canUpload && !isGrad && !uploadStep && !hasGallerySearch && !hasFaceMatches && !selectedGalleryAlbum && (
            <button onClick={() => setUploadStep('album')}
              className="flex items-center gap-2 bg-[#1d2b4b] hover:bg-[#3f51b5] text-white border-none
                         px-5 py-2.5 rounded-[14px] text-[13px] font-bold cursor-pointer transition-colors">
              <i className="fas fa-cloud-arrow-up text-[#fdb813]" /> Upload Media
            </button>
          )}
        </div>

        {selectedGalleryAlbum ? (
          <AlbumPhotoGrid
            album={selectedGalleryAlbum}
            label="Gallery Album"
            onBack={closeInlineAlbum}
            currentUser={user}
            onDeletePhoto={requestDeleteOwnedGalleryPhoto}
          />
        ) : selectedGradAlbum ? (
          <AlbumPhotoGrid
            album={selectedGradAlbum}
            label="Graduation Album"
            onBack={closeInlineAlbum}
            currentUser={user}
          />
        ) : hasFaceMatches ? (
          <FaceSearchResults matches={visibleFaceMatches} isGrad={activeTab !== 'general'} onOpenAlbum={openInlineAlbum} />
        ) : hasGallerySearch ? (
          searchLoading ? (
            <LoadingSkeleton variant="card" count={6} />
          ) : searchResults.length === 0 ? (
            <div className="text-center py-20 px-5 bg-white rounded-3xl shadow-sm border border-slate-100">
              <i className="fas fa-search text-5xl text-slate-200 block mb-4" />
              <h3 className="text-xl font-extrabold text-[#1d2b4b] mb-2">No Gallery Results</h3>
              <p className="text-sm text-slate-400 mb-5">Try another title, event, category, or media name.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-7">
              {searchResults.map(({ album, tab }) => (
                <button key={`${tab.key}-${album.id}`}
                  type="button"
                  onClick={() => openInlineAlbum(album, tab.key)}
                  className="text-left block text-inherit bg-white rounded-[24px] overflow-hidden border border-slate-100 hover:-translate-y-1.5 hover:shadow-xl transition-all cursor-pointer p-0">
                  <div className="h-[190px] bg-slate-100 relative overflow-hidden">
                    <AlbumCover album={album} alt={album.title} icon={tab.icon} />
                    <span className="absolute top-3 right-3 bg-[#1d2b4b] text-white text-[11px] font-black px-3 py-1.5 rounded-xl">
                      <i className={`fas ${tab.icon} text-[#fdb813] mr-1.5`} />{tab.label}
                    </span>
                  </div>
                  <div className="px-5 py-4">
                    <h4 className="text-base font-extrabold text-[#1d2b4b] mb-2">{album.title}</h4>
                    <p className="text-[12px] text-slate-400 m-0 flex items-center gap-1.5">
                      <i className="fas fa-calendar text-[#fdb813]" />
                      {album.event_date
                        ? new Date(album.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
                        : 'No date'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : loading ? (
          <LoadingSkeleton variant="card" count={6} />
        ) : albums.length === 0 ? (
          <div className="text-center py-20 px-5 bg-white rounded-3xl shadow-sm border border-slate-100">
            <i className="fas fa-images text-5xl text-slate-200 block mb-4" />
            <h3 className="text-xl font-extrabold text-[#1d2b4b] mb-2">Nothing Here Yet</h3>
            <p className="text-sm text-slate-400 mb-5">No content in this section yet.</p>
            {canUpload && !isGrad && (
              <button onClick={() => setUploadStep('album')}
                className="inline-flex items-center gap-2 bg-[#1d2b4b] hover:bg-[#3f51b5] text-white border-none
                           px-5 py-2.5 rounded-[14px] text-[13px] font-bold cursor-pointer transition-colors">
                <i className="fas fa-cloud-arrow-up text-[#fdb813]" /> Upload Media
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Photo grids */}
            {(activeTab === 'general' || photoGradTabs.includes(activeTab)) && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-7">
                {albums.map(album => (
                  activeTab === 'general' ? (
                    <div key={album.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => openInlineAlbum(album, 'general')}
                        className="block w-full text-left border-none cursor-pointer text-inherit bg-white rounded-[28px] overflow-hidden
                                   border border-slate-100 hover:-translate-y-2.5 hover:shadow-2xl
                                   transition-all duration-300">
                        <div className="h-[240px] bg-slate-100 relative overflow-hidden">
                          <AlbumCover album={album} alt={album.title} icon="fa-photo-film" />
                          <div className="absolute top-3.5 right-3.5 bg-white/95 px-3 py-[5px] rounded-xl
                                          text-[11px] font-bold text-[#1d2b4b] flex items-center gap-1">
                            <i className="fas fa-photo-film text-[#fdb813]" /> {album.photos_count ?? 0} media
                          </div>
                        </div>
                        <div className="px-6 py-5">
                          <h4 className="text-base font-extrabold text-[#1d2b4b] mb-2">{album.title}</h4>
                          <p className="text-[12px] text-slate-400 m-0 flex items-center gap-1.5">
                            <i className="fas fa-calendar text-[#fdb813]" />
                            {album.event_date
                              ? new Date(album.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
                              : 'No date'}
                          </p>
                        </div>
                      </button>
                      {canUpload && (
                        <button onClick={() => openUploadFromCard(album.id)}
                          className="absolute bottom-[18px] right-[18px] flex items-center gap-1.5
                                     bg-[#1d2b4b] hover:bg-[#3f51b5] text-white border-none px-3.5 py-2
                                     rounded-xl text-[11px] font-bold cursor-pointer z-10 transition-all
                                     opacity-0 group-hover:opacity-100">
                          <i className="fas fa-plus text-[#fdb813]" /> Add Media
                        </button>
                      )}
                    </div>
                  ) : (
                    <GradAlbumCard key={album.id} album={album} onClick={(item) => openInlineAlbum(item, activeTab)} />
                  )
                ))}
              </div>
            )}

            {/* Videos / Baccalaureate Mass tabs */}
            {isVideoTab && (
              <>
                {!selectedVideoAlbum && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
                    {albums.map(album => (
                      <VideoAlbumCard key={album.id} album={album} onClick={setSelectedVideoAlbum} />
                    ))}
                  </div>
                )}

                {selectedVideoAlbum && (
                  <>
                    <button onClick={() => { setSelectedVideoAlbum(null); setVideoLightboxIdx(null); }}
                      className="mb-5 inline-flex items-center gap-2 text-[13px] font-bold text-slate-500
                                 hover:text-[#1d2b4b] border-none bg-transparent cursor-pointer transition-colors">
                      <i className="fas fa-arrow-left" /> Back to all albums
                    </button>

                    {(() => {
                      const videoItems = flattenVideosFromAlbum(selectedVideoAlbum, videoTabBadge);
                      return videoItems.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-3xl border border-slate-100">
                          <i className="fas fa-film text-5xl text-slate-200 block mb-4" />
                          <p className="text-slate-400 text-sm">No videos in this album yet.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
                          {videoItems.map(({ video, photoId, albumId, albumTitle, badge }, i) => (
                            <GradVideoCard
                              key={video.id ?? `v-${i}`}
                              video={video}
                              photoId={photoId}
                              albumId={albumId}
                              albumTitle={albumTitle}
                              badge={badge}
                              onOpen={() => setVideoLightboxIdx(i)}
                            />
                          ))}
                          {videoLightboxIdx !== null && (
                            <VideoLightbox
                              videos={videoItems}
                              startIndex={videoLightboxIdx}
                              onClose={() => setVideoLightboxIdx(null)}
                            />
                          )}
                        </div>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {/* Program tab */}
            {activeTab === 'graduation:program' && (
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-4">
                  <p className="m-0 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500">
                    <i className="fas fa-file-pdf text-[#fdb813] mr-2" /> Program
                  </p>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
                    {albums
                      .filter(a => (a.__programSection ?? 'Program') === 'Program')
                      .map(a => <GradProgramCard key={a.id} album={a} isPremium={isPremium} />)}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <p className="m-0 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500">
                    <i className="fas fa-envelope-open-text text-[#fdb813] mr-2" /> Invitation
                  </p>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
                    {albums
                      .filter(a => a.__programSection === 'Invitation')
                      .map(a => <GradInvitationCard key={a.id} album={a} isPremium={isPremium} />)}
                  </div>
                </div>
              </div>
            )}

            {/* Invitation tab */}

            {/* Grad Song tab */}
            {activeTab === 'graduation:song' && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
                {albums.map(a => <GradSongCard key={a.id} album={a} />)}
              </div>
            )}
          </>
        )}
      </section>

      {deletePhotoTarget && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-[380px] rounded-[22px] bg-white p-6 shadow-2xl border border-slate-100">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
              <i className="fas fa-trash" />
            </div>
            <h3 className="m-0 text-xl font-black text-[#1d2b4b]">Delete this photo?</h3>
            <p className="mt-2 mb-5 text-sm leading-6 text-slate-500 font-semibold">
              Are you sure you want to delete this photo? This removes it from the album and cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletePhotoTarget(null)}
                disabled={deletePhotoLoading}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-extrabold cursor-pointer disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteOwnedGalleryPhoto}
                disabled={deletePhotoLoading}
                className="px-4 py-2.5 rounded-xl border border-red-600 bg-red-600 text-white text-sm font-extrabold cursor-pointer disabled:opacity-60"
              >
                {deletePhotoLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
