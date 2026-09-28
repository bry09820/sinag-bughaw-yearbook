import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { FontAwesome } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { fetchCurrentUser, getConversations, getErrorMessage, getMessageParticipant, getMessageThread, getPresenceBulk, imageUrl, markMessageRead, searchMessageUsers, sendMessage, sendTypingStatus, startMessageConversation, updatePresence, unwrap } from '../../lib/api';

const sameId = (left: any, right: any) => left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
const authUserId = (user: any) => user?.id || user?.user_id || user?.account_user_id || user?.data?.id || user?.user?.id;
const otherUser = (item: any, currentUserId?: any) => {
  if (item?.other_user) return item.other_user;
  if (item?.user) return item.user;
  if (currentUserId && sameId(item?.sender_id, currentUserId)) return item?.receiver;
  if (currentUserId && sameId(item?.receiver_id, currentUserId)) return item?.sender;
  return item?.receiver || item?.sender || item;
};
const personId = (item: any, currentUserId?: any) => {
  const other = otherUser(item, currentUserId);
  if (other?.id) return other.id;
  if (item?.user_id) return item.user_id;
  if (currentUserId && sameId(item?.sender_id, currentUserId)) return item?.receiver_id;
  if (currentUserId && sameId(item?.receiver_id, currentUserId)) return item?.sender_id;
  return item?.receiver_id || item?.sender_id || item?.id;
};
const personName = (item: any, currentUserId?: any) => otherUser(item, currentUserId)?.name || item?.name || 'Conversation';
const personPhoto = (item: any, currentUserId?: any) => imageUrl(otherUser(item, currentUserId)?.profile_picture || item?.profile_picture);
const personCourse = (item: any, currentUserId?: any) => otherUser(item, currentUserId)?.course || item?.course || 'Yearbook profile';
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
const conversationList = (payload: any) => {
  const data = unwrap(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.conversations)) return data.conversations;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(payload?.conversations)) return payload.conversations;
  if (Array.isArray(payload?.data?.conversations)) return payload.data.conversations;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (data && typeof data === 'object') return Object.values(data).filter((item: any) => item && typeof item === 'object');
  return [];
};
const messageList = (payload: any) => {
  const data = unwrap(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (data && typeof data === 'object') return Object.values(data).filter((item: any) => item && typeof item === 'object');
  return [];
};
const formatTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const QUICK_EMOJIS = ['😀', '😂', '😍', '🥰', '😭', '🙏', '👍', '🔥', '🎉', '💙', '💛', '✨'];
const messageImage = (item: any) => imageUrl(item?.image_url || item?.image_path || item?.attachment_url);

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const directUserId = typeof params.userId === 'string' ? params.userId : '';
  const directName = typeof params.name === 'string' ? params.name : '';
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [thread, setThread] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [presence, setPresence] = useState<Record<string, any>>({});
  const [search, setSearch] = useState('');
  const [findMode, setFindMode] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState<any[]>([]);
  const [findLoading, setFindLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const findTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<any>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((item) => personName(item, authUserId(currentUser)).toLowerCase().includes(term));
  }, [conversations, currentUser, search]);

  const runFindSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setFindResults([]);
      return;
    }
    setFindLoading(true);
    try {
      const payload = await searchMessageUsers({ q, limit: 25 });
      const data = unwrap(payload);
      const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      const me = authUserId(currentUser);
      setFindResults(rows.filter((row: any) => !sameId(row?.id || row?.user_id, me)));
    } catch {
      setFindResults([]);
    } finally {
      setFindLoading(false);
    }
  }, [currentUser]);

  const handleFindQueryChange = (text: string) => {
    setFindQuery(text);
    if (findTimer.current) clearTimeout(findTimer.current);
    findTimer.current = setTimeout(() => runFindSearch(text), 300);
  };

  const loadConversations = useCallback(async () => {
    try {
      setError('');
      if (!refreshing) setLoading(true);
      const user = await fetchCurrentUser().catch(() => null);
      const userId = authUserId(user);
      if (user) setCurrentUser(user);
      const payload = await getConversations();
      const nextConversations = conversationList(payload);
      setConversations(nextConversations);

      const ids = Array.from(new Set(nextConversations.map((item: any) => personId(item, userId)).filter(Boolean)));
      if (ids.length) {
        const presencePayload = await getPresenceBulk(ids).catch(() => ({}));
        setPresence(presencePayload || {});
      }
    } catch (requestError: any) {
      setError(getErrorMessage(requestError, 'Unable to load conversations.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshing]);

  const refreshConversationsQuietly = useCallback(async () => {
    try {
      const payload = await getConversations();
      const nextConversations = conversationList(payload);
      setConversations(nextConversations);

      const ids = Array.from(new Set([
        ...nextConversations.map((item: any) => personId(item, authUserId(currentUser))),
        selectedRef.current ? personId(selectedRef.current, authUserId(currentUser)) : null,
      ].filter(Boolean)));
      if (ids.length) {
        const presencePayload = await getPresenceBulk(ids).catch(() => ({}));
        setPresence(presencePayload || {});
      }
    } catch {
      // Keep the current view stable during background refresh failures.
    }
  }, [currentUser]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    updatePresence(true).catch(() => {});
    return () => {
      updatePresence(false).catch(() => {});
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (findTimer.current) clearTimeout(findTimer.current);
    };
  }, []);

  const openThread = useCallback(async (conversation: any) => {
    setSelected(conversation);
    setThread([]);
    setPeerTyping(false);
    setFindMode(false);
    try {
      const id = personId(conversation, authUserId(currentUser));
      const payload = await getMessageThread(id);
      const messages = messageList(payload);
      setThread(messages);
      messages
        .filter((item: any) => !item.is_read && sameId(item.receiver_id, authUserId(currentUser)) && item.id)
        .forEach((item: any) => markMessageRead(item.id).catch(() => {}));
    } catch (requestError: any) {
      Alert.alert('Thread unavailable', getErrorMessage(requestError, 'Unable to load this message thread.'));
    }
  }, [currentUser]);

  const startChatWithUser = useCallback(async (person: any) => {
    const userId = person?.user_id || person?.account_user_id || person?.id;
    if (!userId) {
      Alert.alert('Unavailable', 'This student is not linked to a messaging account.');
      return;
    }

    try {
      await startMessageConversation(userId).catch(() => null);
      const payload = await getMessageParticipant(userId).catch(() => person);
      const participant = unwrap(payload) || person;
      const bootstrap = {
        other_user: {
          id: participant?.id || userId,
          name: participant?.name || person?.name || 'Student',
          profile_picture: participant?.profile_picture || person?.profile_picture,
          course: participant?.course || person?.course,
        },
      };
      setFindMode(false);
      setFindQuery('');
      setFindResults([]);
      await openThread(bootstrap);
    } catch (requestError: any) {
      Alert.alert('Chat unavailable', getErrorMessage(requestError, 'Unable to open this conversation.'));
    }
  }, [openThread]);

  const refreshThreadQuietly = useCallback(async () => {
    const conversation = selectedRef.current;
    const id = conversation ? personId(conversation, authUserId(currentUser)) : null;
    if (!id) return;

    try {
      const payload = await getMessageThread(id);
      const messages = messageList(payload);
      setThread((current) => {
        const currentIds = current.map((item) => String(item?.id));
        const nextIds = messages.map((item: any) => String(item?.id));
        const same = currentIds.length === nextIds.length && currentIds.every((item, index) => item === nextIds[index]);
        return same ? current : messages;
      });
      messages
        .filter((item: any) => !item.is_read && sameId(item.receiver_id, authUserId(currentUser)) && item.id)
        .forEach((item: any) => markMessageRead(item.id).catch(() => {}));
    } catch {
      // Avoid interrupting active chat while polling.
    }
  }, [currentUser]);

  useEffect(() => {
    const timer = setInterval(() => {
      updatePresence(true).catch(() => {});
      refreshConversationsQuietly();
      refreshThreadQuietly();
    }, selected ? 3500 : 8000);

    return () => clearInterval(timer);
  }, [refreshConversationsQuietly, refreshThreadQuietly, selected]);

  useEffect(() => {
    if (!directUserId) return;
    let cancelled = false;

    (async () => {
      const bootstrap = {
        other_user: {
          id: Number(directUserId),
          name: directName || 'Student',
        },
      };
      if (!cancelled) setSelected(bootstrap);

      try {
        await startMessageConversation(directUserId).catch(() => null);
        const payload = await getMessageParticipant(directUserId);
        const participant = unwrap(payload);
        if (!cancelled) {
          setSelected({
            other_user: {
              ...participant,
              id: participant?.id || Number(directUserId),
              name: participant?.name || directName || 'Student',
            },
          });
        }
      } catch {
        // Keep bootstrap identity if participant lookup fails.
      }

      if (!cancelled) await openThread(bootstrap);
    })();

    return () => { cancelled = true; };
  }, [directName, directUserId, openThread]);

  const handleMessageChange = (text: string) => {
    setMessage(text);
    const id = selected ? personId(selected, authUserId(currentUser)) : null;
    if (!id) return;

    sendTypingStatus(id, true).catch(() => {});
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      sendTypingStatus(id, false).catch(() => {});
    }, 1500);
  };

  const handleSend = async () => {
    if ((!message.trim() && !selectedImage) || !selected) return;
    const receiverId = personId(selected, authUserId(currentUser));
    if (!receiverId) {
      Alert.alert('Send failed', 'No message recipient was found.');
      return;
    }
    const body = message.trim();
    const imageAsset = selectedImage;
    const optimistic = {
      id: `optimistic-${Date.now()}`,
      sender_id: authUserId(currentUser),
      receiver_id: receiverId,
      body,
      image_url: imageAsset?.uri || null,
      is_read: false,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    try {
      setSending(true);
      setThread((current) => [...current, optimistic]);
      setMessage('');
      setSelectedImage(null);
      setEmojiOpen(false);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      sendTypingStatus(receiverId, false).catch(() => {});
      const sent = await sendMessage(receiverId, body, imageAsset);
      const saved = unwrap(sent);
      setThread((current) => current.map((item) => item.id === optimistic.id ? saved : item));
      await loadConversations();
    } catch (requestError: any) {
      setThread((current) => current.filter((item) => item.id !== optimistic.id));
      setMessage(body);
      setSelectedImage(imageAsset);
      Alert.alert('Send failed', getErrorMessage(requestError, 'Unable to send your message.'));
    } finally {
      setSending(false);
    }
  };

  const pickMessageImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.[0]) {
      setSelectedImage(result.assets[0]);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topIconButton} onPress={() => router.back()} activeOpacity={0.86}>
          <FontAwesome name="chevron-left" size={18} color="#fdb813" />
        </TouchableOpacity>
        <View style={styles.topTitleWrap}>
          <Text style={styles.headerTitle}>Messages</Text>
          <Text style={styles.headerText}>{conversations.length} conversation{conversations.length === 1 ? '' : 's'}</Text>
        </View>
        <TouchableOpacity
          style={styles.topIconButton}
          onPress={() => {
            setFindMode((value) => !value);
            setFindQuery('');
            setFindResults([]);
            setSearch('');
          }}
          activeOpacity={0.86}
        >
          <FontAwesome name={findMode ? 'times' : 'edit'} size={17} color="#fdb813" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={findMode ? findResults : filteredConversations}
        keyExtractor={(item, index) => String((findMode ? (item?.user_id || item?.id) : personId(item, authUserId(currentUser))) || index)}
        ListHeaderComponent={(
          <>
            <View style={styles.searchContainer}>
              <FontAwesome name="search" size={15} color="#8e8e93" />
              <TextInput
                style={styles.searchInput}
                placeholder={findMode ? 'Search by name, course, or batch...' : 'Search conversations'}
                placeholderTextColor="#8e8e93"
                value={findMode ? findQuery : search}
                onChangeText={findMode ? handleFindQueryChange : setSearch}
                autoFocus={findMode}
              />
              {findMode && findLoading ? <ActivityIndicator size="small" color="#1d2b4b" /> : null}
            </View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{findMode ? 'Find Students' : 'Messages'}</Text>
              <TouchableOpacity
                onPress={() => {
                  setFindMode((value) => !value);
                  setFindQuery('');
                  setFindResults([]);
                }}
              >
                <Text style={styles.requestLink}>{findMode ? 'Done' : 'New'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        renderItem={({ item }) => (
          findMode ? (
            <TouchableOpacity style={styles.card} onPress={() => startChatWithUser(item)} activeOpacity={0.75}>
              <View style={styles.avatarWrap}>
                {imageUrl(item?.profile_picture) ? (
                  <Image source={imageUrl(item.profile_picture)} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials(item?.name)}</Text></View>
                )}
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{item?.name || 'Student'}</Text>
                <Text style={styles.preview} numberOfLines={1}>
                  {[item?.course, item?.batch_year || item?.graduation_year].filter(Boolean).join(' · ') || 'Tap to message'}
                </Text>
              </View>
              <FontAwesome name="comment" size={16} color="#fdb813" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.card} onPress={() => openThread(item)} activeOpacity={0.75}>
              <View style={styles.avatarWrap}>
                {personPhoto(item, authUserId(currentUser)) ? <Image source={personPhoto(item, authUserId(currentUser))} style={styles.avatar} /> : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials(personName(item, authUserId(currentUser)))}</Text></View>}
                <View style={[styles.onlineDot, presence[String(personId(item, authUserId(currentUser)))]?.is_online && styles.onlineDotActive]} />
              </View>
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{personName(item, authUserId(currentUser))}</Text>
                  {!!item?.unread_count && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{item.unread_count}</Text></View>}
                </View>
                <Text style={styles.preview} numberOfLines={1}>{item?.last_message?.body || item?.latest_message?.body || item?.body || item?.message || (messageImage(item) ? 'Sent an image' : 'Open conversation')}</Text>
              </View>
              <View style={styles.trailing}>
                <Text style={styles.timeText}>{formatTime(item?.last_message?.created_at || item?.latest_message?.created_at || item?.created_at)}</Text>
                <FontAwesome name="chevron-right" size={12} color="#d1d5db" />
              </View>
            </TouchableOpacity>
          )
        )}
        ListEmptyComponent={loading || findLoading ? <ActivityIndicator color="#1d2b4b" style={{ marginTop: 26 }} /> : (
          <View style={styles.emptyPanel}>
            <FontAwesome name={findMode ? 'search' : 'comments-o'} size={42} color="#dbe3ef" />
            <Text style={styles.emptyTitle}>
              {error || (findMode
                ? (findQuery.trim() ? `No students matched “${findQuery.trim()}”` : 'Search by name, course, or batch year')
                : 'No conversations yet')}
            </Text>
            {!findMode ? (
              <TouchableOpacity
                style={styles.findButton}
                onPress={() => {
                  setFindMode(true);
                  setFindQuery('');
                  setFindResults([]);
                }}
              >
                <FontAwesome name="search" size={13} color="#fdb813" />
                <Text style={styles.findButtonText}>Find Students</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadConversations(); }} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
      />

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => { setSelected(null); setPeerTyping(false); }}>
        <SafeAreaView style={styles.threadScreen} edges={['top', 'left', 'right']}>
          <KeyboardAvoidingView style={styles.keyboardWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.threadHeader}>
            <TouchableOpacity style={styles.threadBackButton} onPress={() => { setSelected(null); setPeerTyping(false); }} activeOpacity={0.86}>
              <FontAwesome name="chevron-left" size={18} color="#111827" />
            </TouchableOpacity>
            <View style={styles.threadAvatarWrap}>
              {personPhoto(selected, authUserId(currentUser)) ? <Image source={personPhoto(selected, authUserId(currentUser))} style={styles.threadAvatar} /> : <View style={styles.threadAvatarFallback}><Text style={styles.threadAvatarText}>{initials(personName(selected, authUserId(currentUser)))}</Text></View>}
              <View style={[styles.threadOnlineDot, presence[String(personId(selected, authUserId(currentUser)))]?.is_online && styles.onlineDotActive]} />
            </View>
            <View style={styles.threadTitleWrap}>
              <Text style={styles.threadTitle} numberOfLines={1}>{personName(selected, authUserId(currentUser))}</Text>
              <Text style={styles.threadMeta} numberOfLines={1}>
                {peerTyping
                  ? 'Typing…'
                  : (presence[String(personId(selected, authUserId(currentUser)))]?.is_online ? 'Active now' : personCourse(selected, authUserId(currentUser)))}
              </Text>
            </View>
            <TouchableOpacity style={styles.refreshThreadButton} onPress={refreshThreadQuietly}>
              <FontAwesome name="refresh" size={15} color="#1d2b4b" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={thread}
            keyExtractor={(item, index) => String(item?.id || index)}
            renderItem={({ item }) => (
              <View style={[styles.bubble, sameId(item?.sender_id, authUserId(currentUser)) ? styles.mineBubble : null]}>
                {messageImage(item) ? <Image source={messageImage(item)} style={styles.messageImage} contentFit="cover" /> : null}
                {item?.body || item?.message ? <Text style={[styles.bubbleText, sameId(item?.sender_id, authUserId(currentUser)) ? styles.mineText : null]}>{item?.body || item?.message}</Text> : null}
                <Text style={[styles.bubbleTime, sameId(item?.sender_id, authUserId(currentUser)) ? styles.mineTime : null]}>
                  {formatTime(item?.created_at)}
                  {sameId(item?.sender_id, authUserId(currentUser)) && item?.is_read ? ' - Seen' : item?._optimistic ? ' - Sending' : ''}
                </Text>
              </View>
            )}
            contentContainerStyle={styles.threadContent}
            ListEmptyComponent={(
              <View style={styles.emptyPanel}>
                <FontAwesome name="comment-o" size={36} color="#dbe3ef" />
                <Text style={styles.emptyTitle}>Say hello</Text>
                <Text style={styles.emptyText}>No messages yet. Send the first one below.</Text>
              </View>
            )}
          />
          <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
            {emojiOpen ? (
              <View style={styles.emojiTray}>
                {QUICK_EMOJIS.map((emoji) => (
                  <TouchableOpacity key={emoji} style={styles.emojiButton} onPress={() => handleMessageChange(`${message}${emoji}`)}>
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {selectedImage ? (
              <View style={styles.imagePreviewRow}>
                <Image source={selectedImage.uri} style={styles.imagePreview} contentFit="cover" />
                <View style={styles.imagePreviewCopy}>
                  <Text style={styles.imagePreviewTitle} numberOfLines={1}>{selectedImage.fileName || 'Selected image'}</Text>
                  <Text style={styles.imagePreviewMeta}>Ready to send</Text>
                </View>
                <TouchableOpacity style={styles.removeImageButton} onPress={() => setSelectedImage(null)}>
                  <FontAwesome name="times" size={14} color="#64748b" />
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.composerRow}>
              <TouchableOpacity style={styles.composerIconButton} onPress={pickMessageImage} disabled={sending}>
                <FontAwesome name="image" size={17} color="#1d2b4b" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.composerIconButton} onPress={() => setEmojiOpen((value) => !value)} disabled={sending}>
                <FontAwesome name="smile-o" size={18} color="#1d2b4b" />
              </TouchableOpacity>
              <TextInput style={styles.composerInput} placeholder="Message..." placeholderTextColor="#8e8e93" value={message} onChangeText={handleMessageChange} multiline />
              <TouchableOpacity style={[styles.sendButton, (!message.trim() && !selectedImage) ? styles.sendButtonDisabled : null]} onPress={handleSend} disabled={sending || (!message.trim() && !selectedImage)}>
                <FontAwesome name="send" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F8' },
  threadScreen: { flex: 1, backgroundColor: '#F0F2F8' },
  topBar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: '#1d2b4b' },
  topIconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  topTitleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  headerText: { color: 'rgba(255,255,255,0.68)', fontSize: 11, fontWeight: '700', marginTop: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  searchContainer: { height: 42, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginBottom: 16 },
  searchInput: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sectionTitle: { color: '#111827', fontSize: 15, fontWeight: '900' },
  requestLink: { color: '#1d2b4b', backgroundColor: '#fdb813', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, fontSize: 12, fontWeight: '900' },
  card: { minHeight: 78, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 10, marginBottom: 10 },
  avatarWrap: { position: 'relative', marginRight: 13 },
  avatar: { width: 58, height: 58, borderRadius: 29 },
  avatarFallback: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#1d2b4b', justifyContent: 'center', alignItems: 'center' },
  onlineDot: { position: 'absolute', right: 1, bottom: 2, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#cbd5e1' },
  onlineDotActive: { backgroundColor: '#10b981' },
  avatarText: { color: '#fdb813', fontWeight: '900', fontSize: 16 },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '900', color: '#111827', flexShrink: 1 },
  preview: { color: '#8E8E93', fontSize: 14, marginTop: 3 },
  unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#fdb813', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#1d2b4b', fontSize: 10, fontWeight: '900' },
  trailing: { minWidth: 68, alignItems: 'flex-end', gap: 7, marginLeft: 8 },
  timeText: { color: '#8E8E93', fontSize: 12 },
  emptyText: { color: '#8E8E93', textAlign: 'center', padding: 24 },
  emptyPanel: { minHeight: 440, alignItems: 'center', justifyContent: 'center', paddingVertical: 34, paddingHorizontal: 20 },
  emptyTitle: { color: '#111827', fontSize: 16, fontWeight: '900', marginTop: 14, textAlign: 'center' },
  findButton: { minHeight: 44, borderRadius: 22, backgroundColor: '#1d2b4b', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, marginTop: 18 },
  findButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  keyboardWrap: { flex: 1 },
  threadHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#efeff4', backgroundColor: '#ffffff' },
  threadBackButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  threadAvatarWrap: { position: 'relative', marginLeft: 2, marginRight: 10 },
  threadAvatar: { width: 38, height: 38, borderRadius: 19 },
  threadAvatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  threadAvatarText: { color: '#fdb813', fontSize: 12, fontWeight: '900' },
  threadOnlineDot: { position: 'absolute', right: -1, bottom: 0, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#cbd5e1' },
  threadTitleWrap: { flex: 1, justifyContent: 'center', minWidth: 0 },
  threadTitle: { color: '#111827', fontWeight: '900', fontSize: 15 },
  threadMeta: { color: '#8e8e93', fontSize: 11, fontWeight: '700', marginTop: 1 },
  refreshThreadButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  threadContent: { padding: 16, paddingBottom: 24 },
  bubble: { alignSelf: 'flex-start', backgroundColor: '#efeff4', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 20, marginBottom: 8, maxWidth: '82%' },
  mineBubble: { alignSelf: 'flex-end', backgroundColor: '#3797f0' },
  messageImage: { width: 220, height: 180, borderRadius: 14, marginBottom: 7, backgroundColor: '#dbe3ef' },
  bubbleText: { color: '#1C1C1E', fontSize: 14 },
  mineText: { color: '#FFFFFF' },
  bubbleTime: { color: '#8e8e93', fontSize: 10, marginTop: 5 },
  mineTime: { color: 'rgba(255,255,255,0.55)' },
  composer: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#efeff4', backgroundColor: '#FFFFFF' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  composerIconButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', marginRight: 7 },
  composerInput: { flex: 1, minHeight: 42, maxHeight: 110, backgroundColor: '#ffffff', borderRadius: 21, borderWidth: 1, borderColor: '#d1d5db', paddingHorizontal: 15, paddingVertical: 10, marginRight: 8, color: '#111827' },
  sendButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1d2b4b', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#cbd5e1' },
  emojiTray: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 9 },
  emojiButton: { width: 36, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  emojiText: { fontSize: 18 },
  imagePreviewRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', borderRadius: 14, padding: 8, marginBottom: 9 },
  imagePreview: { width: 54, height: 54, borderRadius: 11, backgroundColor: '#dbe3ef' },
  imagePreviewCopy: { flex: 1, marginLeft: 10 },
  imagePreviewTitle: { color: '#111827', fontSize: 13, fontWeight: '900' },
  imagePreviewMeta: { color: '#8e8e93', fontSize: 11, fontWeight: '700', marginTop: 2 },
  removeImageButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
});

