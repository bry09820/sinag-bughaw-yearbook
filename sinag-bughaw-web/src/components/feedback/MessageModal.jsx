import { useEffect, useRef, useState, useCallback } from 'react';
import api from '@/api/client';
import { messagesApi } from '@/api/messaging.api';
import { refreshEchoAuthHeaders } from '@/lib/echo';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

function initials(name = '') {
  return name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() || '').slice(0, 2).join('');
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const palettes = [
  ['bg-amber-100', 'text-[#1d2b4b]'],
  ['bg-indigo-100', 'text-indigo-800'],
  ['bg-emerald-100', 'text-emerald-800'],
  ['bg-pink-100', 'text-pink-800'],
  ['bg-sky-100', 'text-sky-800'],
  ['bg-violet-100', 'text-violet-800'],
];

function getPalette(name = '') {
  const code = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palettes[code % palettes.length];
}

function resolveAvatar(picture) {
  if (!picture) return null;
  if (picture.startsWith('http')) return picture;
  return `${import.meta.env.VITE_APP_URL || ''}/storage/${picture}`;
}

function resolveRecipientId(student) {
  const candidate = student?.user_id ?? student?.account_user_id ?? student?.user?.id ?? student?.id;
  const id = Number(candidate);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function Avatar({ picture, name, size = 'h-9 w-9' }) {
  const [errored, setErrored] = useState(false);
  const src = !errored ? resolveAvatar(picture) : null;
  const [bg, fg] = getPalette(name);

  if (!src) {
    return (
      <div className={`${size} grid shrink-0 place-items-center rounded-full ${bg} ${fg} text-xs font-black`}>
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      onError={() => setErrored(true)}
      className={`${size} shrink-0 rounded-full object-cover`}
    />
  );
}

/**
 * Floating chat panel / Messenger-style chat head.
 *
 * docked=true  → controlled by ChatHeadsProvider; survives route changes
 * docked=false → legacy page-local modal (backdrop closes on outside click)
 */
export default function MessageModal({
  isOpen,
  onClose,
  student,
  authUser,
  docked = false,
  minimized: minimizedProp,
  onMinimize,
  onExpand,
  onIncomingWhileMinimized,
  unreadCount = 0,
  bubbleOffset = 0,
  panelOffset = 0,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [localMinimized, setLocalMinimized] = useState(false);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);
  const iAmTypingRef = useRef(false);
  const recipientId = resolveRecipientId(student);
  const controlled = typeof minimizedProp === 'boolean';
  const minimized = controlled ? minimizedProp : localMinimized;

  const setMinimized = useCallback((next) => {
    const value = typeof next === 'function' ? next(minimized) : Boolean(next);
    if (controlled) {
      if (value) onMinimize?.();
      else onExpand?.();
      return;
    }
    setLocalMinimized(value);
  }, [controlled, minimized, onMinimize, onExpand]);

  const loadThread = useCallback(async () => {
    if (!recipientId) return;
    setLoading(true);
    setError('');
    try {
      try { await messagesApi.start(recipientId); } catch { /* thread still loads empty */ }
      const { data } = await api.get(`/messages/${recipientId}`);
      setMessages(Array.isArray(data) ? data : (data.data ?? []));
    } catch {
      setError('Could not load messages.');
    } finally {
      setLoading(false);
    }
  }, [recipientId]);

  useEffect(() => {
    if (!isOpen) {
      if (!docked && window.Echo && authUser?.id) window.Echo.leave(`chat.${authUser.id}`);
      clearTimeout(typingTimerRef.current);
      iAmTypingRef.current = false;
      return;
    }

    setInput('');
    setError('');
    if (!controlled) setLocalMinimized(false);
    setIsTyping(false);
    loadThread();
  }, [isOpen, recipientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen || minimized) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [isOpen, minimized, recipientId]);

  useEffect(() => {
    if (!isOpen || !recipientId) return undefined;
    const timer = setInterval(() => { loadThread(); }, 4000);
    return () => clearInterval(timer);
  }, [isOpen, recipientId, loadThread]);

  useEffect(() => {
    if (!isOpen || !authUser?.id || !window.Echo) return undefined;
    refreshEchoAuthHeaders();
    const channel = window.Echo.private(`chat.${authUser.id}`)
      .listen('.message.sent', (payload) => {
        if (String(payload.sender_id) === String(recipientId)) {
          setMessages((prev) => prev.find((m) => m.id === payload.id) ? prev : [...prev, payload]);
          api.patch(`/messages/${payload.id}/read`).catch(() => {});
          if (minimized) onIncomingWhileMinimized?.(recipientId);
        }
        window.dispatchEvent(new Event('messaging:unread-updated'));
      })
      .listen('.user.typing', (payload) => {
        if (String(payload.sender_id) === String(recipientId)) {
          setIsTyping(payload.is_typing);
          if (payload.is_typing) {
            clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => setIsTyping(false), 3000);
          }
        }
      });
    return () => {
      if (channel?.stopListening) {
        channel.stopListening('.message.sent');
        channel.stopListening('.user.typing');
      }
      if (!docked && window.Echo) window.Echo.leave(`chat.${authUser.id}`);
    };
  }, [isOpen, authUser?.id, recipientId, minimized, onIncomingWhileMinimized, docked]);

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, minimized]);

  useEffect(() => {
    if (!isOpen || docked) return undefined;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [isOpen, docked, onClose]);

  // Docked: Escape minimizes via the − control path. Outside clicks do NOTHING
  // (dropdowns/menus handle their own dismiss; chat heads stay put).
  useEffect(() => {
    if (!isOpen || !docked || minimized) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMinimized(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, docked, minimized, setMinimized]);

  if (!isOpen) return null;

  // Bubbles are owned by GlobalChatHeads — never render a docked bubble here.
  if (docked && minimized) return null;

  const handleTyping = () => {
    if (!recipientId) return;
    if (!iAmTypingRef.current) {
      iAmTypingRef.current = true;
      api.post('/messages/typing', { receiver_id: recipientId, is_typing: true }).catch(() => {});
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      iAmTypingRef.current = false;
      api.post('/messages/typing', { receiver_id: recipientId, is_typing: false }).catch(() => {});
    }, 1500);
  };

  const handleSend = async () => {
    if (!input.trim() || sending || !recipientId) return;
    const text = input.trim();
    setInput('');
    setError('');
    clearTimeout(typingTimerRef.current);
    if (iAmTypingRef.current) {
      iAmTypingRef.current = false;
      api.post('/messages/typing', { receiver_id: recipientId, is_typing: false }).catch(() => {});
    }
    const tempId = `temp_${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId,
      sender_id: authUser?.id,
      receiver_id: recipientId,
      body: text,
      is_read: false,
      created_at: new Date().toISOString(),
      _pending: true,
    }]);
    setSending(true);
    try {
      const { data } = await api.post('/messages', { receiver_id: recipientId, body: text });
      setMessages((prev) => prev.map((m) => m.id === tempId ? data : m));
    } catch {
      setError('Failed to send. Try again.');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasInput = input.trim().length > 0;
  const peerName = student?.name ?? '';

  const panelRight = 20 + panelOffset * 336;

  return (
    <>
      {!docked && (
        <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      )}

      <section
        id={recipientId ? `sb-chat-panel-${recipientId}` : undefined}
        className="fixed z-[10050] flex h-[420px] w-[320px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-black/15"
        style={{ right: panelRight, bottom: 20 }}
        onClick={(e) => e.stopPropagation()}
        data-chat-panel={recipientId}
      >
        <header
          className="flex shrink-0 cursor-pointer select-none items-center gap-2.5 bg-[#1d2b4b] px-3.5 py-3"
          onClick={() => setMinimized(true)}
        >
          <div className="relative shrink-0">
            <span className="block rounded-full border-2 border-[#fdb813]">
              <Avatar picture={student?.profile_picture} name={peerName} />
            </span>
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#1d2b4b] bg-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[13px] font-bold text-white">{peerName}</p>
            <p className={`m-0 flex items-center gap-1 text-[11px] ${isTyping ? 'text-[#fdb813]' : 'text-white/55'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isTyping ? 'bg-[#fdb813]' : 'bg-emerald-300'}`} />
              {isTyping ? 'typing...' : (student?.course || 'Conversation')}
            </p>
          </div>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-full border-0 bg-white/10 text-[11px] text-white/70 hover:bg-white/20"
            onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
            title="Minimize"
          >
            <i className="fas fa-minus" />
          </button>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-full border-0 bg-white/10 text-[11px] text-white/70 hover:bg-red-500/60"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close"
          >
            <i className="fas fa-times" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#f4f6fa] px-3 py-3.5">
          {!recipientId && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <p className="m-0 text-sm font-bold text-[#1d2b4b]">Messaging unavailable</p>
              <p className="m-0 text-xs text-slate-400">This profile is not linked to a user account.</p>
            </div>
          )}

          {recipientId && loading && (
            <div className="flex-1 pt-3">
              <LoadingSkeleton variant="row" count={4} gridClassName="space-y-3" />
            </div>
          )}

          {recipientId && !loading && messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
              <Avatar picture={student?.profile_picture} name={peerName} size="h-14 w-14" />
              <div>
                <p className="m-0 text-sm font-bold text-[#1d2b4b]">{peerName}</p>
                <p className="m-0 text-xs text-slate-400">Say hi to your fellow Pioneer.</p>
              </div>
            </div>
          )}

          {recipientId && !loading && messages.map((msg) => {
            const isMe = String(msg.sender_id) === String(authUser?.id);
            return (
              <div key={msg.id}>
                <div className={`flex ${isMe ? 'justify-end' : 'items-end justify-start gap-1.5'}`}>
                  {!isMe && <Avatar picture={student?.profile_picture} name={peerName} size="h-6 w-6" />}
                  <div className={`max-w-[75%] break-words px-3 py-2 text-[12.5px] leading-relaxed ${isMe ? 'rounded-2xl rounded-br bg-[#1d2b4b] text-white' : 'rounded-2xl rounded-bl border border-slate-200 bg-white text-[#1d2b4b]'} ${msg._pending ? 'opacity-60' : ''}`}>
                    {msg.body}
                  </div>
                </div>
                <p className={`m-0 mt-0.5 text-[9.5px] text-slate-400 ${isMe ? 'text-right' : 'pl-7'}`}>
                  {formatTime(msg.created_at)}
                  {isMe && msg.is_read && <span className="ml-1 text-[#fdb813]"><i className="fas fa-check-double text-[8px]" /> Seen</span>}
                </p>
              </div>
            );
          })}

          {isTyping && (
            <div className="flex items-end gap-1.5">
              <Avatar picture={student?.profile_picture} name={peerName} size="h-6 w-6" />
              <div className="flex gap-1 rounded-2xl rounded-bl border border-slate-200 bg-white px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
              <p className="m-0 text-[11px] text-red-500">{error}</p>
              <button type="button" className="border-0 bg-transparent text-xs text-red-500" onClick={() => setError('')}>
                <i className="fas fa-times" />
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white px-3 py-2.5">
          <div className="flex-1 rounded-2xl border border-transparent bg-slate-100 px-3 py-2 transition focus-within:border-[#fdb813] focus-within:bg-white">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              placeholder={recipientId ? 'Aa' : 'Unavailable'}
              maxLength={500}
              disabled={!recipientId}
              onChange={(e) => {
                setInput(e.target.value);
                handleTyping();
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 70)}px`;
              }}
              onKeyDown={handleKey}
              className="max-h-[70px] w-full resize-none border-0 bg-transparent text-[12.5px] leading-snug text-[#1d2b4b] outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="button"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-0 transition ${hasInput && recipientId ? 'bg-[#fdb813] text-[#1d2b4b] hover:scale-105' : 'bg-slate-200 text-slate-400'}`}
            onClick={handleSend}
            disabled={!hasInput || sending || !recipientId}
          >
            <i className="fas fa-paper-plane text-xs" />
          </button>
        </div>
      </section>
    </>
  );
}
