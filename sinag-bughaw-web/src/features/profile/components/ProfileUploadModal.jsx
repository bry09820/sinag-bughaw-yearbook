import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useProfileUpload } from '../hooks/useProfileUpload';
import TagPeopleSearch from './TagPeopleSearch';

const VIS_OPTS = [
  { value: 'public',  icon: 'fa-globe',        label: 'Public'  },
  { value: 'batchmates', icon: 'fa-users',      label: 'Batchmates' },
  { value: 'private', icon: 'fa-lock',          label: 'Only Me' },
];

const TIER_INFO = [
  { label: 'Free',       icon: 'fa-eye',   desc: 'View only',             color: 'text-slate-400', bg: 'bg-slate-50',   border: 'border-slate-200'  },
  { label: 'Standard',   icon: 'fa-bolt',  desc: 'HD · up to 10 files',   color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', highlight: true },
  { label: 'Premium HD', icon: 'fa-crown', desc: '4K · 20 files · 10 GB', color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200',  highlight: true },
];

const isMeaningfulText = (value, minLength = 3) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const compact = text.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (text.length < minLength || compact.length < minLength) return false;
  if (/^(test|asdf|qwerty|sample|lorem|abc|haha)+$/i.test(compact)) return false;
  if (/^(.)\1{2,}$/.test(compact)) return false;
  return true;
};

export default function ProfileUploadModal({ onClose, onSuccess }) {
  const { user: authUser } = useAuth();

  const tierKey = authUser?.tier === 'premium'
    ? 'premium'
    : authUser?.tier === 'standard' || authUser?.plan === 'premium'
      ? 'premium_standard'
      : 'free';

  const { canUpload } = useProfileUpload(() => {}, tierKey);

  const MAX_FILES = tierKey === 'premium' ? 20 : tierKey === 'premium_standard' ? 10 : 5;
  const MAX_MB    = 50;

  const multiRef = useRef();

  const [files,            setFiles]            = useState([]);
  const [activeIdx,        setActiveIdx]        = useState(0);
  const [uploading,        setUploading]        = useState(false);
  const [progresses,       setProgresses]       = useState({});
  const [errors,           setErrors]           = useState({});
  const [done,             setDone]             = useState(false);
  const [sharedCaption,    setSharedCaption]    = useState('');
  const [sharedVisibility, setSharedVisibility] = useState('public');
  const [sharedTags,       setSharedTags]       = useState([]);
  const [perFileCaptions,  setPerFileCaptions]  = useState({});

  const totalProgress = files.length
    ? Math.round(Object.values(progresses).reduce((a, b) => a + b, 0) / files.length)
    : 0;

  const handleFilePick = (e) => {
    const selected = Array.from(e.target.files ?? []);
    const valid    = selected.filter(f => f.size <= MAX_MB * 1024 * 1024);
    const entries  = valid.slice(0, MAX_FILES - files.length).map(f => ({
      id:      Math.random().toString(36).slice(2),
      file:    f,
      url:     URL.createObjectURL(f),
      isVideo: f.type.startsWith('video/'),
    }));
    setFiles(prev => {
      const merged = [...prev, ...entries];
      setActiveIdx(merged.length - 1);
      return merged;
    });
    e.target.value = '';
  };

  const removeFile = (id) => {
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      setActiveIdx(i => Math.max(0, Math.min(i, next.length - 1)));
      return next;
    });
    setPerFileCaptions(p => { const c = { ...p }; delete c[id]; return c; });
    setProgresses(p =>      { const c = { ...p }; delete c[id]; return c; });
    setErrors(p =>           { const c = { ...p }; delete c[id]; return c; });
  };

  const uploadAll = async () => {
    if (!files.length || uploading) return;
    if (!isMeaningfulText(sharedCaption, 3)) {
      setErrors(() => {
        const next = {};
        files.forEach(f => { next[f.id] = 'Please enter at least 3 meaningful characters before posting.'; });
        return next;
      });
      return;
    }
    setUploading(true); setErrors({});
    const { profileApi } = await import('@/api/gallery.api');
    const fd = new FormData();
    files.forEach(entry => fd.append('files[]', entry.file));
    fd.append('caption',    sharedCaption);
    fd.append('visibility', sharedVisibility);
    sharedTags.forEach(u => fd.append('tagged_user_ids[]', String(u.id)));
    try {
      await profileApi.uploadMedia(fd, (pct) => {
        setProgresses(() => {
          const next = {};
          files.forEach(f => { next[f.id] = pct; });
          return next;
        });
      });
      setProgresses(() => { const d = {}; files.forEach(f => { d[f.id] = 100; }); return d; });
      setDone(true);
      setTimeout(() => { onSuccess?.(); }, 900);
    } catch (err) {
      const validationErrors = err.response?.data?.errors;
      const firstError = validationErrors ? Object.values(validationErrors).flat()[0] : null;
      const msg = firstError || err.response?.data?.message || 'Upload failed.';
      setErrors(() => { const e = {}; files.forEach(f => { e[f.id] = msg; }); return e; });
    } finally { setUploading(false); }
  };

  return (
    <>
      <style>{`
        @keyframes backdropIn { from{opacity:0} to{opacity:1} }
        @keyframes modalSlide { from{opacity:0;transform:translate(-50%,-46%) scale(0.96)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        @keyframes successPop { 0%{transform:translate(-50%,-50%) scale(0.9);opacity:0} 60%{transform:translate(-50%,-50%) scale(1.04)} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .upload-strip::-webkit-scrollbar { height: 3px; }
        .upload-strip::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 99px; }
        .upload-strip::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={!uploading ? onClose : undefined}
        className="fixed inset-0 z-[1100] bg-[#0a101e]/72 backdrop-blur-md animate-[backdropIn_0.2s_ease]"
      />

      {/* Modal */}
      <div
        className="fixed left-1/2 top-1/2 z-[1101] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl
                   shadow-2xl overflow-hidden"
        style={{ animation: done ? 'successPop 0.3s ease' : 'modalSlide 0.25s cubic-bezier(0.34,1.3,0.64,1)' }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#111827] to-[#1e2d4f] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#fdb813]/15 border border-[#fdb813]/25 flex items-center justify-center">
              <i className="fas fa-images text-[#fdb813] text-sm" />
            </div>
            <div>
              <p className="text-white font-bold text-sm m-0 leading-none">Share Memories</p>
              <p className="text-white/40 text-[10px] m-0 mt-1">
                {canUpload
                  ? `Up to ${MAX_FILES} files · ${tierKey === 'premium' ? 'Premium HD 4K' : 'Standard HD'}`
                  : 'Premium feature'}
              </p>
            </div>
          </div>
          <button
            onClick={!uploading ? onClose : undefined}
            disabled={uploading}
            className="w-8 h-8 rounded-lg bg-white/8 hover:bg-white/15 border-none text-white/55 hover:text-white
                       disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center text-xs transition"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 max-h-[78vh] overflow-y-auto">

          {/* FREE GATE */}
          {!canUpload ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-crown text-[#fdb813] text-2xl" />
              </div>
              <h3 className="text-base font-black text-[#0f172a] mb-2 m-0">Premium Required</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-5 max-w-sm mx-auto">
                Uploading photos and videos is available for subscribers. Upgrade to share your memories.
              </p>

              <div className="grid grid-cols-3 gap-2 mb-5">
                {TIER_INFO.map(t => (
                  <div key={t.label}
                    className={`rounded-xl p-3 text-center border ${t.bg} ${t.border}`}>
                    <i className={`fas ${t.icon} ${t.color} text-lg mb-2 block`} />
                    <p className={`text-[11px] font-black m-0 mb-1 ${t.color}`}>{t.label}</p>
                    <p className="text-[10px] text-slate-500 m-0 leading-snug">{t.desc}</p>
                  </div>
                ))}
              </div>

              <Link to="/premium" onClick={onClose}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-[#fdb813] to-amber-500 text-[#1d2b4b]
                           no-underline px-7 py-3 rounded-xl text-sm font-black shadow-lg shadow-amber-200/40">
                <i className="fas fa-crown text-xs" /> Upgrade Now
              </Link>
              <button onClick={onClose}
                className="block mx-auto mt-3 bg-transparent border-none text-slate-400 text-xs cursor-pointer hover:text-slate-600 transition">
                Maybe later
              </button>
            </div>

          ) : done ? (
            /* SUCCESS */
            <div className="text-center py-10">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-emerald-200/50">
                <i className="fas fa-check text-white text-2xl" />
              </div>
              <h3 className="text-base font-black text-[#0f172a] mb-1 m-0">
                {files.length} {files.length === 1 ? 'photo' : 'photos'} posted!
              </h3>
              <p className="text-sm text-slate-500 m-0">Your memories are live on your profile.</p>
            </div>

          ) : (
            /* UPLOAD FORM */
            <>
              <input
                ref={multiRef}
                type="file" hidden multiple
                accept="image/jpeg,image/png,image/webp,image/heic,image/gif,video/mp4,video/quicktime"
                onChange={handleFilePick}
              />

              {/* Drop zone */}
              {files.length === 0 ? (
                <div
                  onClick={() => multiRef.current.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-[#1d2b4b]', 'bg-slate-100'); }}
                  onDragLeave={e => { e.currentTarget.classList.remove('border-[#1d2b4b]', 'bg-slate-100'); }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-[#1d2b4b]', 'bg-slate-100');
                    handleFilePick({ target: { files: e.dataTransfer.files, value: '' }, preventDefault: () => {} });
                  }}
                  className="border-2 border-dashed border-slate-200 hover:border-[#1d2b4b] hover:bg-slate-50
                             rounded-2xl px-5 py-8 text-center cursor-pointer transition-all mb-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-[#1d2b4b] flex items-center justify-center mx-auto mb-3">
                    <i className="fas fa-cloud-arrow-up text-[#fdb813] text-xl" />
                  </div>
                  <p className="text-sm font-bold text-[#0f172a] mb-1">Click or drag to upload</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    JPEG · PNG · WebP · GIF · HEIC · MP4 · MOV<br />
                    Up to <strong className="text-[#1d2b4b]">{MAX_FILES} files</strong> · Max <strong className="text-[#1d2b4b]">50 MB</strong> each
                  </p>
                </div>
              ) : (
                <>
                  {/* Thumbnail strip */}
                  <div className="upload-strip flex gap-1.5 overflow-x-auto pb-2 mb-3">
                    {files.map((f, i) => (
                      <div key={f.id} onClick={() => setActiveIdx(i)}
                        className={`relative shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-[#0f172a] cursor-pointer transition-all
                          ${i === activeIdx ? 'border-[2.5px] border-[#1d2b4b] shadow-md' : 'border-2 border-slate-200'}`}>
                        {f.isVideo
                          ? <video src={f.url} className="w-full h-full object-cover" muted />
                          : <img   src={f.url} alt="" className="w-full h-full object-cover" />}

                        {/* Progress overlay */}
                        {progresses[f.id] != null && progresses[f.id] < 100 && (
                          <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                            <span className="text-white text-[10px] font-bold">{progresses[f.id]}%</span>
                          </div>
                        )}
                        {progresses[f.id] === 100 && !errors[f.id] && (
                          <div className="absolute inset-0 bg-emerald-500/60 flex items-center justify-center">
                            <i className="fas fa-check text-white text-sm" />
                          </div>
                        )}
                        {errors[f.id] && (
                          <div className="absolute inset-0 bg-red-500/65 flex items-center justify-center">
                            <i className="fas fa-exclamation text-white text-sm" />
                          </div>
                        )}
                        {/* Remove */}
                        {!uploading && (
                          <button onClick={e => { e.stopPropagation(); removeFile(f.id); }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/72 border-none text-white text-[7px] cursor-pointer flex items-center justify-center">
                            <i className="fas fa-times" />
                          </button>
                        )}
                        {f.isVideo && (
                          <div className="absolute bottom-1 left-1 bg-black/60 rounded px-1 py-0.5">
                            <i className="fas fa-video text-white text-[7px]" />
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add more */}
                    {files.length < MAX_FILES && !uploading && (
                      <div onClick={() => multiRef.current.click()}
                        className="shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-slate-200
                                   hover:border-[#1d2b4b] bg-slate-50 hover:bg-slate-100
                                   flex flex-col items-center justify-center gap-1 cursor-pointer transition-all">
                        <i className="fas fa-plus text-slate-400 text-sm" />
                        <span className="text-[8px] text-slate-400 font-bold">{files.length}/{MAX_FILES}</span>
                      </div>
                    )}
                  </div>

                  {/* Active preview */}
                  {files[activeIdx] && (
                    <div className="rounded-xl overflow-hidden bg-[#0f172a] relative mb-3 max-h-52">
                      {files[activeIdx].isVideo
                        ? <video src={files[activeIdx].url} controls className="w-full max-h-52 block" />
                        : <img   src={files[activeIdx].url} alt="Preview" className="w-full max-h-52 object-cover block" />}
                      <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-md">
                        {activeIdx + 1} / {files.length}
                      </div>
                    </div>
                  )}

                  {/* Shared caption */}
                  <div className="mb-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 m-0">
                      <i className="fas fa-pen text-[#fdb813] mr-1.5" />Caption
                    </p>
                    <textarea
                      value={sharedCaption}
                      onChange={e => setSharedCaption(e.target.value)}
                      placeholder="Write a caption for all photos…"
                      rows={2}
                      className="w-full px-3 py-2.5 border-2 border-slate-200 focus:border-[#1d2b4b] rounded-xl resize-none
                                 text-sm text-[#0f172a] outline-none bg-slate-50 leading-relaxed transition-colors box-border mb-2"
                      style={{ fontFamily: 'inherit' }}
                    />
                    {/* Per-file caption override */}
                    {files[activeIdx] && (
                      <textarea
                        value={perFileCaptions[files[activeIdx].id] ?? ''}
                        onChange={e => {
                          const val = e.target.value;
                          setPerFileCaptions(prev => ({ ...prev, [files[activeIdx].id]: val }));
                        }}
                        placeholder={`Override caption for photo ${activeIdx + 1} only (optional)…`}
                        rows={1}
                        className="w-full px-3 py-2 border-2 border-dashed border-slate-200 focus:border-[#3f51b5] rounded-xl resize-none
                                   text-xs text-[#0f172a] outline-none bg-slate-50/50 transition-colors box-border"
                        style={{ fontFamily: 'inherit' }}
                      />
                    )}
                  </div>
                </>
              )}

              {/* Tag people */}
              <div className="mb-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 m-0">
                  <i className="fas fa-user-tag text-[#fdb813] mr-1.5" />Tag People
                </p>
                <TagPeopleSearch
                  tagged={sharedTags}
                  onTag={u  => setSharedTags(prev => [...prev.filter(x => x.id !== u.id), u])}
                  onUntag={u => setSharedTags(prev => prev.filter(x => x.id !== u.id))}
                  excludeId={authUser?.id}
                />
              </div>

              {/* Visibility */}
              <div className="mb-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 m-0">Visibility</p>
                <div className="flex gap-2">
                  {VIS_OPTS.map(opt => (
                    <button key={opt.value} onClick={() => setSharedVisibility(opt.value)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-bold
                                  cursor-pointer border-2 transition-all
                                  ${sharedVisibility === opt.value
                                    ? 'border-[#1d2b4b] bg-[#1d2b4b] text-[#fdb813]'
                                    : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300'}`}>
                      <i className={`fas ${opt.icon} text-[10px]`} /> {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Errors */}
              {Object.keys(errors).length > 0 && (
                <div className="mb-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 flex items-center gap-2">
                  <i className="fas fa-circle-exclamation shrink-0" />
                  {Object.keys(errors).length} file{Object.keys(errors).length > 1 ? 's' : ''} failed. Check your connection and try again.
                </div>
              )}

              {/* Upload progress */}
              {uploading && (
                <div className="mb-4">
                  <div className="flex justify-between text-[10px] text-slate-500 font-semibold mb-1.5">
                    <span>Uploading {files.length} file{files.length > 1 ? 's' : ''}…</span>
                    <span>{totalProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#1d2b4b] to-[#3f51b5] rounded-full transition-all duration-300"
                      style={{ width: `${totalProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={!uploading ? onClose : undefined}
                  disabled={uploading}
                  className="flex-1 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500
                             text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                             hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={uploadAll}
                  disabled={files.length === 0 || uploading}
                  className={`flex-[2] py-3 rounded-xl border-none text-sm font-bold flex items-center justify-center gap-2
                              transition-all cursor-pointer
                              ${files.length === 0 || uploading
                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-[#1d2b4b] to-[#2d4270] text-white hover:opacity-90'}`}
                >
                  {uploading
                    ? <><i className="fas fa-spinner animate-spin" /> Uploading {files.length} file{files.length > 1 ? 's' : ''}…</>
                    : <><i className={`fas fa-cloud-arrow-up ${files.length ? 'text-[#fdb813]' : 'text-slate-400'}`} />
                       Post {files.length > 0 ? `${files.length} Photo${files.length > 1 ? 's' : ''}` : 'to Profile'}</>
                  }
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
