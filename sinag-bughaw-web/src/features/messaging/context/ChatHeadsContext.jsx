import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { chatHeadsStore } from '@/features/messaging/store/chatHeadsStore';

const ChatHeadsContext = createContext(null);

export function ChatHeadsProvider({ children }) {
  const { user } = useAuth();
  const chats = useSyncExternalStore(
    chatHeadsStore.subscribe,
    chatHeadsStore.getSnapshot,
    chatHeadsStore.getSnapshot,
  );
  const prevUserIdRef = useRef(undefined);

  // Clear ONLY on real logout (had a user id → now none). Never on route changes.
  useEffect(() => {
    const nextId = user?.id ?? null;
    // Skip the initial undefined→null auth-loading transition.
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = nextId;
      return;
    }
    if (prevUserIdRef.current && !nextId) {
      chatHeadsStore.clearAll();
    }
    prevUserIdRef.current = nextId;
  }, [user?.id]);

  const openChat = useCallback((student) => (
    chatHeadsStore.openChat(student, user?.id)
  ), [user?.id]);

  const closeChat = useCallback((id) => {
    chatHeadsStore.closeChat(id);
  }, []);

  const minimizeChat = useCallback((id) => {
    chatHeadsStore.minimizeChat(id);
  }, []);

  const expandChat = useCallback((id) => {
    chatHeadsStore.expandChat(id);
  }, []);

  const bumpUnread = useCallback((id) => {
    chatHeadsStore.bumpUnread(id);
  }, []);

  const value = useMemo(() => ({
    chats,
    openChat,
    closeChat,
    minimizeChat,
    expandChat,
    bumpUnread,
  }), [chats, openChat, closeChat, minimizeChat, expandChat, bumpUnread]);

  return (
    <ChatHeadsContext.Provider value={value}>
      {children}
    </ChatHeadsContext.Provider>
  );
}

export function useChatHeads() {
  const ctx = useContext(ChatHeadsContext);
  if (!ctx) {
    throw new Error('useChatHeads must be used within ChatHeadsProvider');
  }
  return ctx;
}

export function useOptionalChatHeads() {
  return useContext(ChatHeadsContext);
}

export { resolveRecipientId, normalizePeer } from '@/features/messaging/store/chatHeadsStore';
