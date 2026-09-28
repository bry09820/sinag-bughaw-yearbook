import { useCallback, useEffect, useRef, useState } from 'react';
import echo, { refreshEchoAuthHeaders }  from '@/lib/echo';
import { messagesApi, presenceApi }      from '@/api/messaging.api';
import { useAuth }                       from '@/features/auth/hooks/useAuth';

const TYPING_DEBOUNCE_MS = 1500;

export function useMessaging(recipientId = null) {
  const { user }                            = useAuth();
  const [conversations, setConversations]   = useState([]);
  const [thread,        setThread]          = useState([]);
  const [loading,       setLoading]         = useState(false);
  const [error,         setError]           = useState(null);
  const [isTyping,      setIsTyping]        = useState(false);
  const [onlineUsers,   setOnlineUsers]     = useState(new Set());
  const [unreadTotal,   setUnreadTotal]     = useState(0);

  const typingTimerRef  = useRef(null);
  const iAmTypingRef    = useRef(false);
  // Track real message IDs we've already added (prevents WS duplicate)
  const seenIdsRef      = useRef(new Set());

  // Conversations

  const fetchConversations = useCallback(async () => {
    try {
      const { data } = await messagesApi.conversations();
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err);
    }
  }, []);

  // Thread

  const fetchThread = useCallback(async (id) => {
    if (!id) return;
    try {
      setLoading(true);
      const { data } = await messagesApi.thread(id);
      const msgs = Array.isArray(data) ? data : (data.data ?? []);
      // Populate seenIds so WS events don't duplicate
      seenIdsRef.current = new Set(msgs.map(m => m.id));
      setThread(msgs);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Send

  const sendMessage = useCallback(async (receiverId, body, image = null) => {
    const tempId = `opt-${Date.now()}`;

    // Optimistic message
    const optimistic = {
      id:          tempId,
      sender_id:   user?.id,
      receiver_id: receiverId,
      body,
      image_url:   image ? URL.createObjectURL(image) : null,
      is_read:     false,
      created_at:  new Date().toISOString(),
      _optimistic: true,
    };
    setThread(prev => [...prev, optimistic]);

    try {
      const { data } = await messagesApi.send(receiverId, body, image);

      // Register the real ID so the WS event doesn't add it again
      seenIdsRef.current.add(data.id);

      // Replace optimistic with real message
      setThread(prev => prev.map(m => m.id === tempId ? data : m));

      fetchConversations();
      return data;
    } catch (err) {
      // Roll back
      setThread(prev => prev.filter(m => m.id !== tempId));
      throw err;
    }
  }, [user?.id, fetchConversations]);

  // Mark read

  const markRead = useCallback(async (id) => {
    await messagesApi.markRead(id);
    setThread(prev =>
      prev.map(m => m.id === id ? { ...m, is_read: true, read_at: new Date().toISOString() } : m)
    );
  }, []);

  // Unread count

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await messagesApi.unreadCount();
      setUnreadTotal(data.unread_count ?? 0);
    } catch {
      // Keep the UI stable if the unread badge refresh fails.
    }
  }, []);

  // Typing

  const onKeystroke = useCallback((receiverId) => {
    if (!iAmTypingRef.current) {
      iAmTypingRef.current = true;
      messagesApi.typing(receiverId, true).catch(() => {});
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      iAmTypingRef.current = false;
      messagesApi.typing(receiverId, false).catch(() => {});
    }, TYPING_DEBOUNCE_MS);
  }, []);

  // WebSocket: private chat channel

  useEffect(() => {
    if (!user?.id) return;

    refreshEchoAuthHeaders();
    const channel = echo.private(`chat.${user.id}`);

    channel.listen('.message.sent', (payload) => {
      // If we already have this message (sent by us + WS echo), skip it
      if (seenIdsRef.current.has(payload.id)) return;

      // Only append to thread if it's from the person we're currently viewing
      if (String(payload.sender_id) === String(recipientId)) {
        seenIdsRef.current.add(payload.id);
        setThread(prev => [...prev, payload]);
        messagesApi.markRead(payload.id).catch(() => {});
      }

      fetchConversations();
      fetchUnreadCount();
      window.dispatchEvent(new Event('messaging:unread-updated'));
    });

    channel.listen('.user.typing', (payload) => {
      if (String(payload.sender_id) === String(recipientId)) {
        setIsTyping(payload.is_typing);
        if (payload.is_typing) {
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setIsTyping(false), 3000);
        }
      }
    });

    return () => {
      echo.leave(`chat.${user.id}`);
    };
  }, [user?.id, recipientId, fetchConversations, fetchUnreadCount]);

  // WebSocket: presence channel

  useEffect(() => {
    if (!user?.id) return;

    refreshEchoAuthHeaders();
    echo.join('online-users')
      .here((members) => {
        setOnlineUsers(new Set(members.map(m => m.id)));
      })
      .joining((member) => {
        setOnlineUsers(prev => new Set([...prev, member.id]));
      })
      .leaving((member) => {
        setOnlineUsers(prev => {
          const next = new Set(prev);
          next.delete(member.id);
          return next;
        });
      });

    presenceApi.update(true).catch(() => {});

    const handleUnload = () => presenceApi.update(false).catch(() => {});
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      echo.leave('online-users');
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [user?.id]);

  // Initial load

  useEffect(() => {
    queueMicrotask(() => {
      fetchConversations();
      fetchUnreadCount();
    });
  }, [fetchConversations, fetchUnreadCount]);

  // Load thread when recipient changes
  useEffect(() => {
    queueMicrotask(() => {
      if (recipientId) {
        seenIdsRef.current = new Set(); // reset seen IDs for new thread
        fetchThread(recipientId);
      } else {
        setThread([]);
      }
    });
  }, [recipientId, fetchThread]);

  // HTTP polling fallback (keeps UI live when Echo/Pusher is unavailable)
  useEffect(() => {
    const pollMs = recipientId ? 4000 : 8000;
    const timer = setInterval(() => {
      fetchConversations();
      fetchUnreadCount();
      if (recipientId) {
        messagesApi.thread(recipientId)
          .then(({ data }) => {
            const msgs = Array.isArray(data) ? data : (data?.data ?? []);
            setThread((prev) => {
              const prevIds = prev.map((m) => String(m.id)).join(',');
              const nextIds = msgs.map((m) => String(m.id)).join(',');
              if (prevIds === nextIds) return prev;
              seenIdsRef.current = new Set(msgs.map((m) => m.id));
              return msgs;
            });
          })
          .catch(() => {});
      }
    }, pollMs);

    return () => clearInterval(timer);
  }, [recipientId, fetchConversations, fetchUnreadCount]);

  return {
    conversations,
    thread,
    loading,
    error,
    isTyping,
    onlineUsers,
    unreadTotal,
    sendMessage,
    markRead,
    onKeystroke,
    fetchConversations,
    fetchThread,
    fetchUnreadCount,
  };
}
