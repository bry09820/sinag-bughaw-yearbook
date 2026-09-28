import { useState, useEffect, useCallback } from 'react';
import { recordContentView } from '@/api/analytics.api';

export default function PostLightbox({ post, initialIdx = 0, onClose }) {
  const [idx,    setIdx]    = useState(initialIdx);
  const [loaded, setLoaded] = useState(false);
  const [animIn, setAnimIn] = useState(false);

  const media   = post?.media ?? [];
  const count   = media.length || 1;
  const current = media[idx] ?? {
    file_path:     post?.file_path,
    resource_type: post?.ai_metadata?.resource_type ?? 'image',
  };
  const isVideo = current.resource_type === 'video'
    || current.file_path?.match(/\.(mp4|mov|webm)(\?|$)/i);

  const poster = post?.user ?? post?.student ?? null;
  const avatar = poster?.profile_picture
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(poster?.name ?? 'U')}&background=1d2b4b&color=fdb813&bold=true&size=80`;

  useEffect(() => { setLoaded(false); }, [idx]);
  useEffect(() => { requestAnimationFrame(() => setAnimIn(true)); }, []);
  useEffect(() => {
    if (!post?.id) return;
    recordContentView({
      content_type: 'post',
      content_id: post.id,
      title: post.caption || 'Profile post',
      category: current.resource_type || 'post',
      url: `/profile/${post.user_id ?? post.user?.id ?? ''}`,
    }).catch(() => {});
  }, [post?.id]);

  const handleClose = useCallback(() => {
    setAnimIn(false);
    setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape')     handleClose();
      if (e.key === 'ArrowRight') setIdx(i => Math.min(count - 1, i + 1));
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [count, handleClose]);

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  if (!post) return null;

  return (
    <>
      <style>{`
        @keyframes lb-shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position:  600px 0; }
        }
        .lb-shimmer-anim {
          background: linear-gradient(90deg, #111 25%, #1a1a1a 50%, #111 75%);
          background-size: 600px 100%;
          animation: lb-shimmer 1.4s infinite linear;
        }
        .lb-scrollbar::-webkit-scrollbar { width: 4px; }
        .lb-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .lb-scrollbar::-webkit-scrollbar-thumb { background: #dbdbdb; border-radius: 4px; }
      `}</style>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center transition-opacity duration-200 ${animIn ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="fixed top-4 right-5 z-[10000] bg-transparent border-none text-white text-2xl cursor-pointer opacity-75 hover:opacity-100 transition-opacity flex items-center justify-center"
          aria-label="Close"
        >
          <i className="fas fa-times" />
        </button>

        {/* Shell */}
        <div
          className={`relative flex w-[min(900px,94vw)] max-h-[92vh] bg-black rounded-sm overflow-hidden
                      shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_80px_rgba(0,0,0,0.8)]
                      transition-all duration-200 ${animIn ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
                      flex-col sm:flex-row`}
          onClick={e => e.stopPropagation()}
        >

          {/* LEFT: media */}
          <div className="relative flex-[0_0_62%] bg-black flex items-center justify-center overflow-hidden min-h-[260px] sm:min-h-[480px]">

            {/* Shimmer while loading */}
            <div className={`lb-shimmer-anim absolute inset-0 pointer-events-none transition-opacity duration-200 ${loaded ? 'opacity-0' : 'opacity-100'}`} />

            {isVideo ? (
              <video
                key={current.file_path}
                src={current.file_path}
                controls autoPlay
                className={`w-full h-full object-contain block max-h-[92vh] transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                onLoadedData={() => setLoaded(true)}
              />
            ) : (
              <img
                key={current.file_path}
                src={current.file_path}
                alt={post.caption ?? ''}
                className={`w-full h-full object-contain block max-h-[92vh] transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setLoaded(true)}
              />
            )}

            {/* Multi-image badge */}
            {count > 1 && (
              <div className="absolute top-2.5 right-2.5 bg-black/55 rounded-md px-2 py-1 flex items-center gap-1.5 z-[4]">
                <i className="fas fa-images text-white text-[10px]" />
                <span className="text-white text-[11px] font-bold">{idx + 1}/{count}</span>
              </div>
            )}

            {/* Prev arrow */}
            {idx > 0 && (
              <button
                onClick={e => { e.stopPropagation(); setIdx(i => i - 1); }}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white border-none cursor-pointer flex items-center justify-center shadow-md transition-all hover:scale-110 z-[4] text-[11px] text-black"
                aria-label="Previous"
              >
                <i className="fas fa-chevron-left" />
              </button>
            )}

            {/* Next arrow */}
            {idx < count - 1 && (
              <button
                onClick={e => { e.stopPropagation(); setIdx(i => i + 1); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white border-none cursor-pointer flex items-center justify-center shadow-md transition-all hover:scale-110 z-[4] text-[11px] text-black"
                aria-label="Next"
              >
                <i className="fas fa-chevron-right" />
              </button>
            )}

            {/* Dot indicators */}
            {count > 1 && (
              <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1 z-[4]">
                {media.map((_, i) => (
                  <button
                    key={i}
                    onClick={e => { e.stopPropagation(); setIdx(i); }}
                    className={`h-1.5 rounded-full border-none cursor-pointer transition-all duration-200 p-0
                      ${i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`}
                    aria-label={`Go to image ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: sidebar */}
          <div className="flex-[0_0_38%] bg-white flex flex-col border-l border-[#dbdbdb] overflow-hidden max-h-[40vh] sm:max-h-none">

            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[#efefef] shrink-0">
              <img
                src={avatar}
                alt={poster?.name ?? ''}
                className="w-9 h-9 rounded-full object-cover shrink-0 border-2 border-[#fdb813]"
                onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=U&background=1d2b4b&color=fdb813&bold=true`; }}
              />
              <div>
                <p className="text-sm font-bold text-[#1d2b4b] m-0 leading-none">{poster?.name ?? 'Pioneer Student'}</p>
                <p className="text-[11px] text-slate-400 m-0 mt-1">
                  NU Lipa{poster?.graduation_year || poster?.batch ? ` · ${poster.graduation_year || poster.batch}` : ''}
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto lb-scrollbar px-4 py-4">

              {/* Caption */}
              {post.caption ? (
                <div className="flex gap-2.5 mb-4">
                  <img
                    src={avatar}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                    onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=U&background=1d2b4b&color=fdb813&bold=true`; }}
                  />
                  <div>
                    <span className="text-sm font-bold text-[#1d2b4b] mr-1.5">{poster?.name ?? 'Pioneer Student'}</span>
                    <span className="text-sm text-[#262626] leading-relaxed">{post.caption}</span>
                    <p className="text-[11px] text-slate-400 mt-1.5 m-0">{formatDate(post.created_at)}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic m-0 mb-4">No caption.</p>
              )}

              {/* Tagged students */}
              {post.tagged_students?.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 m-0">
                    <i className="fas fa-user-tag text-[#fdb813] mr-1.5" />Tagged
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {post.tagged_students.map(s => (
                      <span key={s.id}
                        className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-100 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#3f51b5]">
                        <i className="fas fa-at text-[9px]" />{s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
