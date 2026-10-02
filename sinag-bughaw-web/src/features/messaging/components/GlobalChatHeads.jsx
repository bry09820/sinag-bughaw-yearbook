import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useChatHeads } from '@/features/messaging/context/ChatHeadsContext';
import MessageModal from '@/components/feedback/MessageModal';

function resolveAvatar(picture) {
  if (!picture) return null;
  if (String(picture).startsWith('http')) return picture;
  return `${import.meta.env.VITE_APP_URL || ''}/storage/${picture}`;
}

function initials(name = '') {
  return name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() || '').slice(0, 2).join('') || '?';
}

/**
 * Persistent circular bubble — rendered independently of the chat panel so
 * minimize / route changes cannot unmount it via MessageModal internals.
 */
function ChatHeadBubble({ chat, offset, onExpand, onClose }) {
  const [imgError, setImgError] = useState(false);
  const name = chat.student?.name || 'Chat';
  const src = !imgError ? resolveAvatar(chat.student?.profile_picture) : null;
  const bottom = 24 + offset * 72;

  return (
    <div
      className="group fixed z-[10050]"
      style={{ right: 20, bottom }}
      data-chat-head={chat.id}
    >
      <button
        type="button"
        title={name}
        onClick={onExpand}
        className="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 shadow-[0_10px_28px_rgba(15,23,42,0.28)] transition hover:scale-105 focus:outline-none"
      >
        <span className="relative block h-14 w-14 overflow-hidden rounded-full border-[3px] border-white bg-[#1d2b4b] ring-2 ring-[#fdb813]/80">
          {src ? (
            <img
              src={src}
              alt={name}
              onError={() => setImgError(true)}
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <span className="grid h-14 w-14 place-items-center text-sm font-black text-[#fdb813]">
              {initials(name)}
            </span>
          )}
        </span>
        <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />
        {(chat.unread || 0) > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-[20px] min-w-[20px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white shadow">
            {chat.unread > 9 ? '9+' : chat.unread}
          </span>
        )}
      </button>

      <span className="pointer-events-none absolute right-16 top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#1d2b4b] px-2.5 py-1.5 text-[11px] font-bold text-white shadow-lg group-hover:block">
        {name}
      </span>

      <button
        type="button"
        title="Close chat"
        aria-label="Close chat"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="absolute -left-1 -top-1 z-[1] hidden h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-slate-700 text-[9px] text-white shadow group-hover:grid hover:bg-red-500"
      >
        <i className="fas fa-times" />
      </button>
    </div>
  );
}

/**
 * Global overlay. Chat list lives in a module store — route changes never reset it.
 * Outside clicks do nothing to heads. Only − minimizes and × closes.
 */
export default function GlobalChatHeads() {
  const { user } = useAuth();
  const { chats, closeChat, minimizeChat, expandChat } = useChatHeads();
  const { pathname } = useLocation();

  const hideOnAuthScreens =
    pathname === '/login'
    || pathname === '/register'
    || pathname === '/forgot-password'
    || pathname === '/'
    || pathname.startsWith('/sso/')
    || pathname === '/maintenance';

  const hideOnMessages = pathname.startsWith('/messages');
  const hidden = hideOnAuthScreens || hideOnMessages || !user;

  if (typeof document === 'undefined' || chats.length === 0) return null;

  const minimizedChats = chats.filter((chat) => chat.minimized);
  const expandedChats = chats.filter((chat) => !chat.minimized);

  return createPortal(
    <div
      id="sb-global-chat-heads"
      // CSS hide only — never unmount / clear store on route change.
      style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      aria-hidden={hidden}
    >
      {minimizedChats.map((chat, index) => (
        <ChatHeadBubble
          key={`bubble-${chat.id}`}
          chat={chat}
          offset={index}
          onExpand={() => expandChat(chat.id)}
          onClose={() => closeChat(chat.id)}
        />
      ))}

          {expandedChats.map((chat, index) => (
        <MessageModal
          key={`panel-${chat.id}`}
          isOpen
          docked
          student={chat.student}
          authUser={user}
          minimized={false}
          panelOffset={index}
          onClose={() => closeChat(chat.id)}
          onMinimize={() => minimizeChat(chat.id)}
          onExpand={() => expandChat(chat.id)}
        />
      ))}
    </div>,
    document.body,
  );
}
