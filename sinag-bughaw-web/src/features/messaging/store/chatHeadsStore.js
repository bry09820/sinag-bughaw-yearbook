/**
 * Module-level chat-heads store.
 * Survives React remounts, route changes, and auth object identity refreshes.
 * Context is only a thin React subscription layer over this singleton.
 */
const MAX_CHAT_HEADS = 5;
const STORAGE_KEY = 'sb_chat_heads';

const listeners = new Set();

function readStoredChats() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((chat) => chat && Number(chat.id) > 0 && chat.student)
      .slice(-MAX_CHAT_HEADS)
      .map((chat) => ({
        id: Number(chat.id),
        student: chat.student,
        minimized: Boolean(chat.minimized),
        unread: Number(chat.unread) || 0,
      }));
  } catch {
    return [];
  }
}

function writeStoredChats(chats) {
  try {
    if (!chats.length) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    /* ignore */
  }
}

let chats = readStoredChats();

function emit() {
  writeStoredChats(chats);
  listeners.forEach((listener) => listener());
}

export function resolveRecipientId(student) {
  const candidate =
    student?.user_id
    ?? student?.account_user_id
    ?? student?.user?.id
    ?? student?.id;
  const id = Number(candidate);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function normalizePeer(student) {
  const id = resolveRecipientId(student);
  if (!id) return null;

  const name =
    student?.name
    || [student?.first_name, student?.last_name].filter(Boolean).join(' ').trim()
    || 'Student';

  return {
    id,
    user_id: id,
    name,
    profile_picture:
      student?.profile_picture
      || student?.photo_url
      || student?.photo
      || student?.avatar
      || null,
    course: student?.course || student?.program || null,
  };
}

export const chatHeadsStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot() {
    return chats;
  },

  /** Replace or update chats. Never called implicitly by routing. */
  setChats(next) {
    chats = typeof next === 'function' ? next(chats) : next;
    if (!Array.isArray(chats)) chats = [];
    emit();
  },

  openChat(student, currentUserId = null) {
    const peer = normalizePeer(student);
    if (!peer) return false;
    if (currentUserId && String(peer.id) === String(currentUserId)) return false;

    chatHeadsStore.setChats((prev) => {
      const existing = prev.find((chat) => String(chat.id) === String(peer.id));
      if (existing) {
        return prev.map((chat) => ({
          ...chat,
          student: String(chat.id) === String(peer.id) ? { ...chat.student, ...peer } : chat.student,
          // Focus this chat; keep others as they were (usually minimized).
          minimized: String(chat.id) !== String(peer.id) ? true : false,
          unread: String(chat.id) === String(peer.id) ? 0 : chat.unread,
        }));
      }

      return [
        ...prev.map((chat) => ({ ...chat, minimized: true })),
        { id: peer.id, student: peer, minimized: false, unread: 0 },
      ].slice(-MAX_CHAT_HEADS);
    });

    return true;
  },

  /** Remove chat permanently — only via explicit X button. */
  closeChat(id) {
    chatHeadsStore.setChats((prev) => prev.filter((chat) => String(chat.id) !== String(id)));
  },

  /** Dock to bubble. Never removes the chat from the list. */
  minimizeChat(id) {
    chatHeadsStore.setChats((prev) => prev.map((chat) => (
      String(chat.id) === String(id) ? { ...chat, minimized: true } : chat
    )));
  },

  expandChat(id) {
    chatHeadsStore.setChats((prev) => prev.map((chat) => ({
      ...chat,
      minimized: String(chat.id) !== String(id),
      unread: String(chat.id) === String(id) ? 0 : chat.unread,
    })));
  },

  bumpUnread(id) {
    chatHeadsStore.setChats((prev) => prev.map((chat) => {
      if (String(chat.id) !== String(id) || !chat.minimized) return chat;
      return { ...chat, unread: (chat.unread || 0) + 1 };
    }));
  },

  /** Only for logout — never on route change. */
  clearAll() {
    chats = [];
    emit();
  },
};
