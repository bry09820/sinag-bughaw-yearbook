import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { FontAwesome } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { fetchCurrentUser, getAppConfig, getDiscoveryStudent, getErrorMessage, getFaceStudentPhotos, getMessageParticipant, getStudent, getStudentAchievements, getStudentPosts, getVoiceNotesForProfile, imageUrl, sendVoiceNote, trackStudentView, unwrap } from '../../../lib/api';

const DISCOVERY_TABS = [
  { key: 'profile', label: 'Profile', icon: 'user-o' },
  { key: 'academic', label: 'Academic', icon: 'graduation-cap' },
  { key: 'yearbook', label: 'Yearbook', icon: 'book' },
  { key: 'messages', label: 'Messages', icon: 'comments' },
];

const DIRECTORY_TABS = [
  { key: 'profile', label: 'Posts', icon: 'th-large' },
  { key: 'academic', label: 'Academic', icon: 'graduation-cap' },
  { key: 'awards', label: 'Awards', icon: 'trophy' },
  { key: 'voice-legacy', label: 'Voice', icon: 'microphone' },
];

const safeStudent = (user: any) => user?.student_record || user?.studentRecord || user?.student || user?.record || {};
const normalizeProfilePayload = (payload: any) => {
  const raw = unwrap(payload);
  if (raw?.student && (raw?.restricted || raw?.visibility || !raw?.name)) {
    return { ...raw.student, restricted: raw.restricted, visibility: raw.visibility, message: raw.message };
  }
  return raw?.student && raw.student?.name && !raw.name ? raw.student : raw;
};
const fullName = (user: any) => {
  const student = safeStudent(user);
  return user?.name || user?.full_name || student?.name || student?.full_name || `${user?.first_name || student?.first_name || ''} ${user?.last_name || student?.last_name || ''}`.trim() || 'Student';
};
const profilePhoto = (user: any) => {
  const student = safeStudent(user);
  return imageUrl(user?.profile_picture || user?.profile_pic || user?.avatar || student?.profile_picture || student?.profile_pic || student?.photo || user?.photo);
};
const course = (user: any) => {
  const student = safeStudent(user);
  return student?.course || student?.program || user?.course || user?.program || user?.course_short || 'Pioneer Student';
};
const year = (user: any) => {
  const student = safeStudent(user);
  return student?.graduation_year || student?.batch_year || student?.year || user?.graduation_year || user?.batch_year || user?.year || user?.batch || '';
};
const fieldValue = (user: any, key: string) => safeStudent(user)?.[key] || user?.[key] || '';
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NU';
const listFromPayload = (payload: any) => {
  const raw = unwrap(payload);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
};
const listFromValue = (value: any) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).map((title, index) => ({ id: `text-${index}`, title }));
  }
  return [];
};
const postMedia = (post: any) => Array.isArray(post?.media) && post.media.length ? post.media : post?.file_path ? [{ file_path: post.file_path, resource_type: post?.ai_metadata?.resource_type }] : [];
const mediaUrl = (item: any) => imageUrl(item?.file_path || item?.url || item?.path);
const facePhotoUrl = (item: any) => imageUrl(item?.file_path || item?.url || item?.path || item?.photo_url || item?.image_url || item?.photo?.file_path);
const isVideo = (item: any) => String(item?.resource_type || '').toLowerCase() === 'video' || /\.(mp4|mov|webm|avi|mkv)(\?|$)/i.test(String(item?.file_path || item?.url || ''));
const formatDuration = (seconds?: number) => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : null;
const audioUrl = (note: any) => imageUrl(note?.audio_url || note?.audio_path || note?.url);
const normalizeAudioUri = (uri: string) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  return `file://${uri}`;
};
const audioUploadPart = (uri: string) => {
  const normalizedUri = normalizeAudioUri(uri);
  const cleanUri = normalizedUri.split('?')[0] || normalizedUri;
  const extension = cleanUri.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'm4a';
  const mimeByExtension: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
  };

  return {
    uri: normalizedUri,
    name: `voice-memory.${extension}`,
    type: mimeByExtension[extension] || 'audio/mp4',
  };
};
const isPremium = (user: any) => Boolean(user?.is_premium || user?.is_subscribed || user?.tier === 'premium' || user?.tier === 'standard');
const hasPaidAccess = isPremium;
const profileUserId = (profile: any, fallback?: any, includeProfileId = true) =>
  profile?.user_id ||
  profile?.account_user_id ||
  profile?.user?.id ||
  safeStudent(profile)?.user_id ||
  safeStudent(profile)?.user?.id ||
  (includeProfileId ? profile?.id : null) ||
  fallback;

function Avatar({ user }: { user: any }) {
  const photo = profilePhoto(user);
  if (photo) return <Image source={photo} style={styles.avatar} contentFit="cover" />;
  return <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials(fullName(user))}</Text></View>;
}

export default function StudentProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    id,
    source,
    userId: routeUserId,
    studentRecordId: routeStudentRecordId,
    name: routeName,
    course: routeCourse,
    year: routeYear,
    section: routeSection,
    studentNo: routeStudentNo,
    email: routeEmail,
    photo: routePhoto,
  } = useLocalSearchParams();
  const studentId = Array.isArray(id) ? id[0] : id;
  const sourceName = Array.isArray(source) ? source[0] : source;
  const explicitUserId = Array.isArray(routeUserId) ? routeUserId[0] : routeUserId;
  const explicitStudentRecordId = Array.isArray(routeStudentRecordId) ? routeStudentRecordId[0] : routeStudentRecordId;
  const routeFallback = useMemo(() => ({
    id: explicitUserId || studentId,
    user_id: explicitUserId || null,
    student_record_id: explicitStudentRecordId || null,
    name: Array.isArray(routeName) ? routeName[0] : routeName,
    course: Array.isArray(routeCourse) ? routeCourse[0] : routeCourse,
    program: Array.isArray(routeCourse) ? routeCourse[0] : routeCourse,
    graduation_year: Array.isArray(routeYear) ? routeYear[0] : routeYear,
    batch_year: Array.isArray(routeYear) ? routeYear[0] : routeYear,
    section_name: Array.isArray(routeSection) ? routeSection[0] : routeSection,
    student_no: Array.isArray(routeStudentNo) ? routeStudentNo[0] : routeStudentNo,
    email: Array.isArray(routeEmail) ? routeEmail[0] : routeEmail,
    profile_picture: Array.isArray(routePhoto) ? routePhoto[0] : routePhoto,
    photo: Array.isArray(routePhoto) ? routePhoto[0] : routePhoto,
  }), [explicitStudentRecordId, explicitUserId, routeCourse, routeEmail, routeName, routePhoto, routeSection, routeStudentNo, routeYear, studentId]);
  const isDiscoveryProfile = sourceName === 'discovery';
  const [student, setStudent] = useState<any>(routeFallback);
  const [viewer, setViewer] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [facePhotos, setFacePhotos] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<any[]>([]);
  const [tab, setTab] = useState('profile');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<any>(null);
  const [appConfig, setAppConfig] = useState<any>(null);
  const [voiceTitle, setVoiceTitle] = useState('Voice memory');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationSeconds, setRecordedDurationSeconds] = useState(0);
  const [voiceSending, setVoiceSending] = useState(false);
  const [selectedMediaPost, setSelectedMediaPost] = useState<any>(null);
  const playerRef = useRef<any>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 300);

  const name = fullName(student);
  const canShowYearbook = Boolean(year(student));
  const userId = explicitUserId || profileUserId(student, !isDiscoveryProfile ? studentId : null, !isDiscoveryProfile);
  const features = appConfig?.features || {};
  const postsEnabled = features.allow_student_posts !== false;
  const premiumBadgeEnabled = features.premium_badge_display !== false;
  const directoryEnabled = features.enable_student_directory_search !== false;
  const schoolName = appConfig?.school_name || 'National University Lipa';
  const visibleTabs = isDiscoveryProfile ? DISCOVERY_TABS : DIRECTORY_TABS;
  const viewerHasPaidAccess = hasPaidAccess(viewer);
  const discoveryLocked = isDiscoveryProfile && !viewerHasPaidAccess;
  const voiceLocked = !viewerHasPaidAccess;
  const profileVisibility = String(student?.visibility || student?.profile_visibility || '').toLowerCase();
  const isBatchmatesOnlyProfile = ['batchmates', 'alumni_only'].includes(profileVisibility);

  const loadProfile = useCallback(async () => {
    if (!studentId) return;
    try {
      setError('');
      if (!refreshing) setLoading(true);

      const [configResult, viewerResult, profileResult] = await Promise.allSettled([
        getAppConfig(),
        fetchCurrentUser(),
        isDiscoveryProfile ? getDiscoveryStudent(studentId) : getStudent(studentId),
      ]);
      let profile: any = null;
      if (configResult.status === 'fulfilled') setAppConfig(unwrap(configResult.value));
      if (viewerResult.status === 'fulfilled') setViewer(viewerResult.value);
      const primaryProfile = profileResult;

      if (primaryProfile.status === 'fulfilled') {
        profile = normalizeProfilePayload(primaryProfile.value);
        setStudent(profile);
        setAchievements(listFromValue(profile?.achievements));
      } else {
        const responseData = primaryProfile.reason?.response?.data;
        const restrictedStudent = responseData?.student;
        if (restrictedStudent) {
          profile = restrictedStudent;
          setStudent(restrictedStudent);
          const restrictedVisibility = String(responseData?.visibility || restrictedStudent?.visibility || '').toLowerCase();
          setError(['batchmates', 'alumni_only'].includes(restrictedVisibility)
            ? ''
            : getErrorMessage(primaryProfile.reason, 'Upgrade to view the full student profile.'));
        } else {
          setError(getErrorMessage(primaryProfile.reason, 'Unable to load this student profile.'));
        }
      }

      const resolvedUserId = explicitUserId || profileUserId(profile, !isDiscoveryProfile ? studentId : null, !isDiscoveryProfile);
      if (!resolvedUserId) {
        setPosts([]);
        setFacePhotos([]);
        setVoiceNotes([]);
        return;
      }

      trackStudentView(resolvedUserId).catch(() => {});

      if (isDiscoveryProfile && !hasPaidAccess(viewerResult.status === 'fulfilled' ? viewerResult.value : null)) {
        setPosts([]);
        setFacePhotos([]);
        setVoiceNotes([]);
        return;
      }

      const canLoadVoice = hasPaidAccess(viewerResult.status === 'fulfilled' ? viewerResult.value : null);
      const [postsResult, achievementsResult, voiceResult, facePhotosResult] = await Promise.allSettled([
        getStudentPosts(resolvedUserId),
        getStudentAchievements(resolvedUserId),
        canLoadVoice ? getVoiceNotesForProfile(resolvedUserId) : Promise.resolve([]),
        getFaceStudentPhotos(resolvedUserId),
      ]);

      if (postsResult.status === 'fulfilled') setPosts(listFromPayload(postsResult.value));
      if (achievementsResult.status === 'fulfilled') setAchievements(listFromPayload(achievementsResult.value));
      if (voiceResult.status === 'fulfilled') setVoiceNotes(listFromPayload(voiceResult.value));
      if (facePhotosResult.status === 'fulfilled') setFacePhotos(listFromPayload(facePhotosResult.value));

      const failed = [postsResult, achievementsResult, voiceResult, facePhotosResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed && !isDiscoveryProfile) setError(getErrorMessage(failed.reason, 'Some profile sections could not be loaded.'));
    } catch (requestError: any) {
      setError(getErrorMessage(requestError, 'Unable to load this student profile.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [explicitUserId, isDiscoveryProfile, refreshing, studentId]);

  useFocusEffect(React.useCallback(() => {
    loadProfile();
  }, [loadProfile]));

  const stats = useMemo(() => [
    { label: 'Posts', value: posts.length },
    { label: 'Awards', value: achievements.length },
    { label: 'Voice', value: voiceNotes.length },
  ], [achievements.length, posts.length, voiceNotes.length]);

  const messageStudent = async () => {
    const recipientId =
      userId ||
      profileUserId(student, null, false) ||
      explicitUserId;

    if (!recipientId) {
      Alert.alert('Message unavailable', 'This student record is not linked to a user account yet.');
      return;
    }

    try {
      const payload = await getMessageParticipant(recipientId);
      const participant = unwrap(payload);
      const resolvedId = participant?.id || participant?.user_id || recipientId;
      router.push({
        pathname: '/messages',
        params: {
          userId: String(resolvedId),
          name: participant?.name || name,
        },
      } as any);
    } catch {
      router.push({ pathname: '/messages', params: { userId: String(recipientId), name } } as any);
    }
  };

  const toggleVoice = (note: any) => {
    const url = audioUrl(note);
    if (!url) return;
    if (playing === note.id) {
      playerRef.current?.pause?.();
      setPlaying(null);
      return;
    }
    playerRef.current?.pause?.();
    playerRef.current?.remove?.();
    const player = createAudioPlayer({ uri: url });
    playerRef.current = player;
    setPlaying(note.id);
    player.play();
  };

  const startRecording = async () => {
    if (voiceLocked) {
      Alert.alert('Voice locked', 'Upgrade to Standard or Premium to send voice memories.');
      return;
    }

    if (!userId) {
      Alert.alert('Voice unavailable', 'This student record is not linked to a user account yet.');
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access to record a voice memory.');
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 300 });
      setRecordedUri(null);
      setRecordedDurationSeconds(0);
    } catch (requestError: any) {
      Alert.alert('Recording failed', getErrorMessage(requestError, 'Unable to start recording.'));
    }
  };

  const stopRecording = async () => {
    try {
      const durationBeforeStop = Math.round((recorderState.durationMillis || 0) / 1000);
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const status = recorder.getStatus();
      setRecordedUri(status.url || recorder.uri || null);
      setRecordedDurationSeconds(Math.max(1, durationBeforeStop));
    } catch (requestError: any) {
      Alert.alert('Recording failed', getErrorMessage(requestError, 'Unable to stop recording.'));
    }
  };

  const submitVoiceNote = async () => {
    if (voiceLocked) {
      Alert.alert('Voice locked', 'Upgrade to Standard or Premium to send voice memories.');
      return;
    }

    if (!userId || !recordedUri) return;

    try {
      setVoiceSending(true);
      const durationSeconds = Math.max(1, recordedDurationSeconds || Math.round((recorderState.durationMillis || 0) / 1000));
      const form = new FormData();
      form.append('recipient_id', String(userId));
      form.append('title', voiceTitle.trim() || 'Voice memory');
      form.append('duration_seconds', String(durationSeconds));
      form.append('audio', audioUploadPart(recordedUri) as any);

      await sendVoiceNote(form);
      setRecordedUri(null);
      setRecordedDurationSeconds(0);
      setVoiceTitle('Voice memory');
      const payload = await getVoiceNotesForProfile(userId);
      setVoiceNotes(listFromPayload(payload));
      Alert.alert('Voice memory sent', 'Your voice note is pending approval before it appears on this profile.');
    } catch (requestError: any) {
      Alert.alert('Send failed', getErrorMessage(requestError, 'Unable to send this voice memory.'));
    } finally {
      setVoiceSending(false);
    }
  };

  const openMediaPost = (media: any, post: any = null) => {
    const url = mediaUrl(media) || facePhotoUrl(media);
    if (!url) {
      Alert.alert('Post unavailable', 'This post image is not available right now.');
      return;
    }

    setSelectedMediaPost({
      media,
      post,
      url,
      title: post?.title || post?.caption || media?.title || media?.caption || 'Post',
      caption: post?.caption || media?.caption || media?.description || '',
    });
  };

  const renderDiscoveryHeader = () => {
    const honorsList = listFromValue(fieldValue(student, 'honors'));
    const sectionName = fieldValue(student, 'section')?.name || fieldValue(student, 'section_name') || fieldValue(student, 'section') || student?.section?.name || '';
    const studentNo = fieldValue(student, 'student_no') || fieldValue(student, 'student_id') || '';
    const motto = fieldValue(student, 'motto') || fieldValue(student, 'student_quote');

    return (
      <>
        <View style={styles.discoveryCard}>
          <View style={styles.discoveryCover}>
          <View style={styles.discoveryCoverBorder} />
            <View style={styles.discoveryCoverTags}>
              <Text style={styles.discoveryCoverTag}>NU Lipa</Text>
              <Text style={styles.discoveryCoverDot}>•</Text>
              <Text style={styles.discoveryCoverTag} numberOfLines={1}>{course(student)}</Text>
              {year(student) ? (
                <>
                  <Text style={styles.discoveryCoverDot}>•</Text>
                  <Text style={styles.discoveryCoverBatch}>Batch {`'${String(year(student)).slice(-2)}`}</Text>
                </>
              ) : null}
            </View>
          </View>

          <View style={styles.discoveryBody}>
            <View style={styles.discoveryTopRow}>
              <View style={styles.discoveryAvatarWrap}>
                <Avatar user={student} />
                <View style={styles.discoveryOnlineDot} />
              </View>
              <TouchableOpacity style={styles.discoveryShareButton}>
                <FontAwesome name="share-alt" size={13} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.discoveryNameRow}>
              <Text style={styles.discoveryName}>{name}</Text>
              {year(student) ? (
                <View style={styles.discoveryGraduateBadge}>
                  <FontAwesome name="graduation-cap" size={9} color="#047857" />
                  <Text style={styles.discoveryGraduateText}>GRADUATE {year(student)}</Text>
                </View>
              ) : null}
            </View>
            {!!fieldValue(student, 'nickname') && !discoveryLocked && <Text style={styles.discoveryNickname}>{`"${fieldValue(student, 'nickname')}"`}</Text>}
            <Text style={styles.discoveryMeta}>{course(student)} - {schoolName}</Text>

            <View style={styles.discoveryStatsGrid}>
              {[
                { value: course(student), label: 'Program' },
                { value: year(student) || 'N/A', label: 'Batch' },
                { value: discoveryLocked ? 'Locked' : sectionName || 'N/A', label: 'Section' },
                { value: discoveryLocked ? 'Locked' : studentNo || 'N/A', label: 'ID' },
                { value: discoveryLocked ? 'Locked' : honorsList[0]?.title || honorsList[0]?.name || honorsList[0] || '-', label: 'Honors' },
              ].map((item) => (
                <View key={item.label} style={styles.discoveryStat}>
                  <Text style={styles.discoveryStatValue} numberOfLines={2}>{String(item.value)}</Text>
                  <Text style={styles.discoveryStatLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={messageStudent}>
                <FontAwesome name="paper-plane" size={13} color="#fdb813" />
                <Text style={styles.primaryButtonText}>Message</Text>
              </TouchableOpacity>
            </View>

            {discoveryLocked ? (
              <LockedPanel title="Full profile locked" text="Upgrade to Standard or Premium to view student information, yearbook details, and tagged photos." onPress={() => router.push('/payment' as any)} />
            ) : (
              <Text style={[styles.discoveryMotto, !motto && styles.discoveryMottoEmpty]}>
                {`"${motto || 'No motto added yet.'}"`}
              </Text>
            )}
          </View>
        </View>
        {renderTabs()}
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </>
    );
  };

  const renderDirectoryHeader = () => (
    <>
      <View style={styles.profileCard}>
        <View style={styles.cover}>
        </View>
        <View style={styles.profileBody}>
          <View style={styles.avatarRing}><Avatar user={student} /></View>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
            {premiumBadgeEnabled && isPremium(student) ? (
              <View style={styles.tierBadge}>
                <FontAwesome name="star" size={10} color="#1d2b4b" />
                <Text style={styles.tierText}>{student?.tier === 'standard' ? 'Standard' : 'Premium'}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.meta}>{course(student)} - {schoolName}</Text>
          {canShowYearbook ? <Text style={styles.gradBadge}>CLASS OF {year(student)}</Text> : null}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={messageStudent}>
              <FontAwesome name="paper-plane" size={13} color="#fdb813" />
              <Text style={styles.primaryButtonText}>Message</Text>
            </TouchableOpacity>
            {directoryEnabled ? (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push({ pathname: '/directory', params: { q: name } } as any)}>
                <FontAwesome name="search" size={13} color="#1d2b4b" />
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.statsRow}>
            {stats.map((item) => (
              <View key={item.label} style={styles.statItem}>
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      {renderTabs()}
      {isBatchmatesOnlyProfile ? (
        <Text style={styles.batchmatesOnlyNotice}>This profile is visible to batchmates only.</Text>
      ) : null}
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </>
  );

  const renderTabs = () => (
    <View style={styles.tabs}>
      {visibleTabs.map((item) => {
        const active = tab === item.key;
        return (
          <TouchableOpacity key={item.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(item.key)}>
            <FontAwesome name={item.icon as any} size={13} color={active ? '#fdb813' : '#94a3b8'} />
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderHeader = () => isDiscoveryProfile ? renderDiscoveryHeader() : renderDirectoryHeader();

  const renderContent = () => {
    if (loading) return <ActivityIndicator color="#1d2b4b" style={{ marginTop: 34 }} />;

    if (tab === 'profile') {
      if (isDiscoveryProfile) {
        if (discoveryLocked) {
          return <LockedPanel title="Student details locked" text="Standard or Premium is required to view basic information and tagged photos from Discovery." onPress={() => router.push('/payment' as any)} />;
        }

        const sectionName = fieldValue(student, 'section')?.name || fieldValue(student, 'section_name') || fieldValue(student, 'section') || student?.section?.name || '';
        return (
          <View style={styles.panelStack}>
            <View>
              <View style={styles.blockTitleRow}>
                <FontAwesome name="id-card" size={12} color="#f5a623" />
                <Text style={styles.blockTitle}>Basic Information</Text>
              </View>
              <View style={styles.discoveryInfoGrid}>
                <InfoTile icon="hashtag" label="Student No." value={fieldValue(student, 'student_no') || fieldValue(student, 'student_id')} />
                <InfoTile icon="user" label="Full Name" value={name} />
                <InfoTile icon="envelope" label="Email" value={fieldValue(student, 'email')} />
                <InfoTile icon="map-marker" label="Hometown" value={fieldValue(student, 'hometown')} />
                <InfoTile icon="book" label="Program" value={course(student)} />
                <InfoTile icon="graduation-cap" label="Batch Year" value={year(student)} />
                <InfoTile icon="th-large" label="Section" value={sectionName ? `Section ${sectionName}` : ''} />
              </View>
            </View>
          </View>
        );
      }

      if (!postsEnabled) {
        return <Empty icon="lock" title="Posts Disabled" text="Student posts are currently disabled by platform settings." />;
      }

      return posts.length || facePhotos.length ? (
        <View style={styles.panelStack}>
          {posts.length ? (
            <View>
              <View style={styles.blockTitleRow}>
                <FontAwesome name="th-large" size={12} color="#f5a623" />
                <Text style={styles.blockTitle}>Posts</Text>
              </View>
              <View style={styles.grid}>
                {posts.map((post) => {
                  const item = postMedia(post)[0];
                  const url = mediaUrl(item);
                  return (
                    <TouchableOpacity key={String(post.id)} style={styles.cell} onPress={() => openMediaPost(item, post)}>
                      {url && !isVideo(item) ? <Image source={url} style={styles.cellImage} contentFit="cover" /> : url && isVideo(item) ? (
                        <View style={styles.videoCell}><FontAwesome name="video-camera" size={22} color="#fdb813" /><Text style={styles.videoText}>Video</Text></View>
                      ) : <FontAwesome name="camera" size={26} color="#cbd5e1" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
          {facePhotos.length ? (
            <View>
              <View style={styles.blockTitleRow}>
                <FontAwesome name="tag" size={12} color="#f5a623" />
                <Text style={styles.blockTitle}>Tagged Photos</Text>
              </View>
              <View style={styles.grid}>
                {facePhotos.map((photo, index) => {
                  const url = facePhotoUrl(photo);
                  return (
                    <TouchableOpacity key={String(photo?.id || index)} style={styles.cell} onPress={() => openMediaPost(photo, photo)}>
                      {url ? <Image source={url} style={styles.cellImage} contentFit="cover" /> : <FontAwesome name="image" size={26} color="#cbd5e1" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : <Empty icon="camera" title="No Posts Yet" text="No public posts or face-matched photos are available for this profile." />;
    }

    if (tab === 'academic') {
      if (discoveryLocked) {
        return <LockedPanel title="Academic details locked" text="Upgrade to Standard or Premium to view honors, organizations, and achievements." onPress={() => router.push('/payment' as any)} />;
      }

      return (
        <View style={styles.panelStack}>
          <SectionBlock
            icon="star-o"
            title="Honors & Awards"
            emptyIcon="user-o"
            emptyTitle="No Honors Yet"
            emptyText="This student hasn't added any honors yet."
            items={listFromValue(fieldValue(student, 'honors'))}
          />
          <SectionBlock
            icon="users"
            title="Organizations"
            emptyIcon="users"
            emptyTitle="No Organizations"
            emptyText="This student hasn't added any organizations yet."
            items={listFromValue(fieldValue(student, 'organizations'))}
          />
          <SectionBlock
            icon="trophy"
            title="Achievements"
            emptyIcon="trophy"
            emptyTitle="No Achievements Yet"
            emptyText="This student hasn't added any achievements yet."
            items={achievements.length ? achievements : listFromValue(fieldValue(student, 'achievements'))}
          />
        </View>
      );
    }

    if (tab === 'awards') {
      return (
        <View style={styles.panelStack}>
          <SectionBlock
            icon="trophy"
            title="Awards & Achievements"
            emptyIcon="trophy"
            emptyTitle="No Awards Yet"
            emptyText="This student has not added awards yet."
            items={achievements.length ? achievements : listFromValue(fieldValue(student, 'achievements'))}
          />
        </View>
      );
    }

    if (tab === 'yearbook') {
      if (discoveryLocked) {
        return <LockedPanel title="Yearbook details locked" text="Upgrade to Standard or Premium to view quotes, memories, ambitions, and yearbook messages." onPress={() => router.push('/payment' as any)} />;
      }

      const yearbookRows = [
        { label: 'Personal Motto', value: fieldValue(student, 'motto') || fieldValue(student, 'student_quote') },
        { label: 'Student Quote', value: fieldValue(student, 'student_quote') },
        { label: 'Ambition', value: fieldValue(student, 'ambition') },
        { label: 'Future Plans', value: fieldValue(student, 'future_plans') },
        { label: 'Fondest Memory', value: fieldValue(student, 'fondest_memory') },
        { label: 'Most Likely To', value: fieldValue(student, 'most_likely_to') },
      ].filter((item) => item.value);

      return (
        <View style={styles.yearbookPanel}>
          <View style={styles.yearbookBadge}>
            <View style={styles.yearbookIcon}>
              <FontAwesome name="graduation-cap" size={14} color="#ffffff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.yearbookBadgeTitle}>Graduate - Class of {year(student) || '2025'}</Text>
              <Text style={styles.yearbookBadgeText}>{course(student)} - {schoolName}</Text>
            </View>
          </View>

          {yearbookRows.length ? yearbookRows.map((item) => (
            <View key={item.label} style={styles.yearbookLine}>
              <Text style={styles.yearbookLabel}>{item.label}</Text>
              <Text style={styles.yearbookValue}>{`"${String(item.value)}"`}</Text>
            </View>
          )) : <Empty icon="book" title="No Yearbook Details" text="Yearbook profile details will appear here." compact />}
        </View>
      );
    }

    if (tab === 'messages') {
      if (discoveryLocked) {
        return <LockedPanel title="Yearbook messages locked" text="Upgrade to Standard or Premium to view yearbook dedications to batchmates and parents. Direct messaging is available to all registered students." onPress={() => router.push('/payment' as any)} />;
      }

      return (
        <View style={styles.panelStack}>
          <MessageBlock
            title="To My Batchmates"
            value={fieldValue(student, 'message_to_batchmates')}
            fallback="Bago tayo magkakilala, iba ako. Salamat sa pagbabago."
          />
          <MessageBlock
            title="To My Parents"
            value={fieldValue(student, 'message_to_parents')}
            fallback="Hindi kayo mababayaran ng anumang awards. Mahal ko kayo."
          />
        </View>
      );
    }

    if (tab === 'voice-legacy') {
      if (voiceLocked) {
        return <LockedPanel title="Voice memories locked" text="Upgrade to Standard or Premium to view and send voice memories." onPress={() => router.push('/payment' as any)} />;
      }

      return (
        <View style={styles.voiceWrap}>
          <View style={styles.voiceComposer}>
            <View style={styles.voiceComposerHeader}>
              <View style={styles.voiceComposerIcon}>
                <FontAwesome name={recorderState.isRecording ? 'circle' : 'microphone'} size={16} color="#fdb813" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.voiceComposerTitle}>{recordedUri ? 'Recording ready' : recorderState.isRecording ? 'Recording voice memory' : 'Send a voice memory'}</Text>
                <Text style={styles.voiceComposerText}>
                  {recorderState.isRecording
                    ? formatDuration(Math.round((recorderState.durationMillis || 0) / 1000)) || '0:00'
                    : recordedUri
                      ? formatDuration(recordedDurationSeconds) || '0:01'
                      : 'Voice notes are reviewed before appearing.'}
                </Text>
              </View>
            </View>
            <TextInput
              style={styles.voiceInput}
              value={voiceTitle}
              onChangeText={setVoiceTitle}
              placeholder="Voice memory title"
              placeholderTextColor="#94a3b8"
            />
            <View style={styles.voiceActionRow}>
              <TouchableOpacity style={[styles.recordButton, recorderState.isRecording && styles.recordButtonStop]} onPress={recorderState.isRecording ? stopRecording : startRecording}>
                <FontAwesome name={recorderState.isRecording ? 'stop' : 'microphone'} size={13} color="#ffffff" />
                <Text style={styles.recordButtonText}>{recorderState.isRecording ? 'Stop' : recordedUri ? 'Re-record' : 'Record'}</Text>
              </TouchableOpacity>
              {recordedUri ? (
                <TouchableOpacity style={styles.sendVoiceButton} onPress={submitVoiceNote} disabled={voiceSending}>
                  {voiceSending ? <ActivityIndicator size="small" color="#1d2b4b" /> : <FontAwesome name="paper-plane" size={13} color="#1d2b4b" />}
                  <Text style={styles.sendVoiceText}>Send</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {voiceNotes.length ? (
            <View style={styles.card}>
              {voiceNotes.map((note, index) => {
                const active = playing === note.id;
                return (
                  <View key={String(note.id || index)} style={[styles.row, index < voiceNotes.length - 1 && styles.rowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{note?.title || 'Voice Memory'}</Text>
                      <Text style={styles.rowText}>From {note?.sender?.name || 'Classmate'}{formatDuration(note?.duration_seconds) ? ` - ${formatDuration(note.duration_seconds)}` : ''}</Text>
                      <View style={styles.waveRow}>
                        {Array.from({ length: 18 }, (_, waveIndex) => (
                          <View key={String(waveIndex)} style={[styles.waveBar, { height: 7 + Math.abs(Math.sin(waveIndex * 0.8)) * 12, backgroundColor: active ? '#fdb813' : '#e2e8f0' }]} />
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity style={[styles.playButton, active && styles.playButtonActive]} onPress={() => toggleVoice(note)}>
                      <FontAwesome name={active ? 'pause' : 'play'} size={13} color={active ? '#1d2b4b' : '#fdb813'} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : <Empty icon="microphone-slash" title="No Voice Notes" text="No approved voice memories yet." />}
        </View>
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <FlatList
        data={[{ id: 'content' }]}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        renderItem={renderContent}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 118 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadProfile(); }} />}
      />
      <View pointerEvents="box-none" style={styles.floatingLayer}>
        <TouchableOpacity
          style={[styles.floatingBackButton, { marginTop: insets.top + 8 }]}
          onPress={() => router.back()}
          activeOpacity={0.86}
        >
          <FontAwesome name="chevron-left" size={18} color="#1d2b4b" />
        </TouchableOpacity>
      </View>
      <Modal
        visible={!!selectedMediaPost}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMediaPost(null)}
      >
        <View style={styles.postViewerOverlay}>
          <TouchableOpacity style={styles.postViewerBackdrop} activeOpacity={1} onPress={() => setSelectedMediaPost(null)} />
          <View style={styles.postViewerCard}>
            <View style={styles.postViewerHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.postViewerKicker}>Tagged post</Text>
                <Text style={styles.postViewerTitle} numberOfLines={2}>{selectedMediaPost?.title || 'Post'}</Text>
              </View>
              <TouchableOpacity style={styles.postViewerClose} onPress={() => setSelectedMediaPost(null)} activeOpacity={0.86}>
                <FontAwesome name="times" size={16} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            {selectedMediaPost?.url && !isVideo(selectedMediaPost?.media) ? (
              <Image source={selectedMediaPost.url} style={styles.postViewerImage} contentFit="contain" />
            ) : (
              <View style={styles.postViewerVideo}>
                <FontAwesome name="video-camera" size={28} color="#fdb813" />
                <Text style={styles.postViewerVideoText}>Video post</Text>
              </View>
            )}
            {!!selectedMediaPost?.caption && <Text style={styles.postViewerCaption}>{selectedMediaPost.caption}</Text>}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SectionBlock({ icon, title, emptyIcon, emptyTitle, emptyText, items }: { icon: any; title: string; emptyIcon: any; emptyTitle: string; emptyText: string; items: any[] }) {
  return (
    <View>
      <View style={styles.blockTitleRow}>
        <FontAwesome name={icon} size={12} color="#f5a623" />
        <Text style={styles.blockTitle}>{title}</Text>
      </View>
      <View style={styles.whiteBlock}>
        {items.length ? items.map((item, index) => (
          <View key={String(item?.id || index)} style={[styles.row, index < items.length - 1 && styles.rowBorder]}>
            <View style={styles.rowIcon}><FontAwesome name={icon} size={14} color="#fdb813" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item?.title || item?.name || String(item)}</Text>
              {!!(item?.subtitle || item?.description || item?.date_awarded || item?.year) && (
                <Text style={styles.rowText}>{item?.subtitle || item?.description || item?.date_awarded || item?.year}</Text>
              )}
            </View>
          </View>
        )) : <Empty icon={emptyIcon} title={emptyTitle} text={emptyText} compact />}
      </View>
    </View>
  );
}

function MessageBlock({ title, value, fallback }: { title: string; value: any; fallback: string }) {
  return (
    <View>
      <View style={styles.blockTitleRow}>
        <FontAwesome name="users" size={12} color="#f5a623" />
        <Text style={styles.blockTitle}>{title}</Text>
      </View>
      <View style={styles.messageCard}>
        <Text style={styles.messageText}>{`"${String(value || fallback)}"`}</Text>
      </View>
    </View>
  );
}

function InfoTile({ icon, label, value }: { icon: any; label: string; value: any }) {
  if (!value) return null;
  return (
    <View style={styles.infoTile}>
      <View style={styles.infoTileHeader}>
        <FontAwesome name={icon} size={10} color="#f5a623" />
        <Text style={styles.infoTileLabel}>{label}</Text>
      </View>
      <Text style={styles.infoTileValue}>{String(value)}</Text>
    </View>
  );
}

function Empty({ icon, title, text, compact = false }: { icon: any; title: string; text: string; compact?: boolean }) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <FontAwesome name={icon} size={compact ? 26 : 40} color="#dbe3ef" />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function LockedPanel({ title, text, onPress }: { title: string; text: string; onPress: () => void }) {
  return (
    <View style={styles.lockedPanel}>
      <View style={styles.lockedIcon}>
        <FontAwesome name="lock" size={18} color="#1d2b4b" />
      </View>
      <Text style={styles.lockedTitle}>{title}</Text>
      <Text style={styles.lockedText}>{text}</Text>
      <TouchableOpacity style={styles.lockedButton} onPress={onPress} activeOpacity={0.88}>
        <FontAwesome name="credit-card" size={12} color="#ffffff" />
        <Text style={styles.lockedButtonText}>Choose a plan</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7fe' },
  content: {},
  discoveryCard: { margin: 14, backgroundColor: '#ffffff', borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(200,155,60,0.35)' },
  discoveryCover: { height: 136, backgroundColor: '#071a33', position: 'relative', overflow: 'hidden' },
  discoveryCoverBorder: { position: 'absolute', left: 12, right: 12, top: 18, bottom: 16, borderWidth: 1, borderColor: 'rgba(200,155,60,0.35)' },
  discoveryCoverTags: { position: 'absolute', left: 18, right: 18, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  discoveryCoverTag: { color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 6, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', maxWidth: 150 },
  discoveryCoverDot: { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '900' },
  discoveryCoverBatch: { color: '#fdb813', backgroundColor: 'rgba(253,184,19,0.10)', borderWidth: 1, borderColor: 'rgba(253,184,19,0.22)', borderRadius: 6, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: '900' },
  discoveryBody: { paddingHorizontal: 18, paddingBottom: 18 },
  discoveryTopRow: { marginTop: -52, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  discoveryAvatarWrap: { padding: 4, backgroundColor: '#ffffff', borderRadius: 60, borderWidth: 3, borderColor: '#fdb813' },
  discoveryOnlineDot: { position: 'absolute', right: 9, bottom: 9, width: 13, height: 13, borderRadius: 7, backgroundColor: '#34d399', borderWidth: 2, borderColor: '#ffffff' },
  discoveryShareButton: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  discoveryNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  discoveryName: { color: '#071a33', fontSize: 25, lineHeight: 30, fontWeight: '900' },
  discoveryGraduateBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#bbf7d0', backgroundColor: '#ecfdf5', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  discoveryGraduateText: { color: '#047857', fontSize: 9, fontWeight: '900' },
  discoveryNickname: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginTop: 3 },
  discoveryMeta: { color: '#64748b', fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 5 },
  discoveryStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderBottomWidth: 1, borderBottomColor: '#eef2ff', paddingBottom: 13, marginTop: 14 },
  discoveryStat: { minWidth: 54, maxWidth: 116, alignItems: 'center' },
  discoveryStatValue: { color: '#1d2b4b', fontSize: 11, lineHeight: 15, fontWeight: '900', textAlign: 'center' },
  discoveryStatLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '700', marginTop: 3 },
  discoveryMotto: { color: 'rgba(23,32,51,0.72)', fontSize: 12, lineHeight: 18, fontStyle: 'italic', borderLeftWidth: 3, borderLeftColor: '#c89b3c', paddingLeft: 10, marginTop: 13 },
  discoveryMottoEmpty: { color: '#cbd5e1', borderLeftColor: '#e2e8f0' },
  discoveryInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoTile: { width: '48%', backgroundColor: '#fbf7ef', borderWidth: 1, borderColor: 'rgba(216,199,162,0.45)', padding: 12, minHeight: 74 },
  infoTileHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  infoTileLabel: { color: '#8f7d55', fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  infoTileValue: { color: '#071a33', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  profileCard: { margin: 14, backgroundColor: '#ffffff', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  cover: { height: 128, backgroundColor: '#1d2b4b' },
  floatingLayer: { ...StyleSheet.absoluteFillObject, zIndex: 999, elevation: 999, paddingTop: 10, paddingLeft: 16 },
  floatingBackButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 999 },
  profileBody: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 22 },
  avatarRing: { marginTop: -56, padding: 4, backgroundColor: '#ffffff', borderRadius: 60, borderWidth: 3, borderColor: '#fdb813' },
  avatar: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#eef2ff' },
  avatarFallback: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fdb813', fontSize: 34, fontWeight: '900' },
  nameRow: { marginTop: 14, alignItems: 'center', justifyContent: 'center', gap: 8 },
  name: { color: '#1d2b4b', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  tierBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: '#fdb813', paddingHorizontal: 10, paddingVertical: 5 },
  tierText: { color: '#1d2b4b', fontSize: 10, fontWeight: '900' },
  meta: { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 7 },
  gradBadge: { marginTop: 8, color: '#047857', backgroundColor: '#ecfdf5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden', fontSize: 10, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 18 },
  primaryButton: { flex: 1, height: 46, borderRadius: 13, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  secondaryButton: { width: 48, height: 46, borderRadius: 13, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  statsRow: { flexDirection: 'row', width: '100%', borderTopWidth: 1, borderTopColor: '#eef2ff', marginTop: 20, paddingTop: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: '#1d2b4b', fontSize: 16, fontWeight: '900' },
  statLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', marginTop: 3 },
  tabs: { marginHorizontal: 14, marginBottom: 12, backgroundColor: '#ffffff', borderRadius: 16, flexDirection: 'row', overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  tab: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 5 },
  tabActive: { backgroundColor: '#f8fafc', borderBottomWidth: 2, borderBottomColor: '#1d2b4b' },
  tabText: { color: '#94a3b8', fontSize: 10, fontWeight: '900' },
  tabTextActive: { color: '#1d2b4b' },
  batchmatesOnlyNotice: { marginHorizontal: 14, marginBottom: 12, color: '#b45309', fontSize: 17, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  errorText: { marginHorizontal: 16, color: '#b45309', textAlign: 'center', marginBottom: 10 },
  lockedPanel: { marginHorizontal: 14, marginBottom: 14, borderRadius: 18, backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#fde68a', padding: 18, alignItems: 'center' },
  lockedIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fdb813', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  lockedTitle: { color: '#1d2b4b', fontSize: 18, lineHeight: 23, fontWeight: '900', textAlign: 'center' },
  lockedText: { color: '#92590e', fontSize: 13, lineHeight: 20, fontWeight: '700', textAlign: 'center', marginTop: 7 },
  lockedButton: { minHeight: 42, borderRadius: 13, backgroundColor: '#1d2b4b', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  lockedButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  grid: { marginHorizontal: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 18, overflow: 'hidden' },
  cell: { width: '32.8%', aspectRatio: 1, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  cellImage: { width: '100%', height: '100%' },
  videoCell: { width: '100%', height: '100%', backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center', gap: 7 },
  videoText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  postViewerOverlay: { flex: 1, backgroundColor: 'rgba(7,26,51,0.72)', justifyContent: 'center', padding: 18 },
  postViewerBackdrop: { ...StyleSheet.absoluteFillObject },
  postViewerCard: { maxHeight: '86%', borderRadius: 18, backgroundColor: '#ffffff', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(226,232,240,0.8)' },
  postViewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: '#eef2ff' },
  postViewerKicker: { color: '#f5a623', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  postViewerTitle: { color: '#1d2b4b', fontSize: 17, lineHeight: 22, fontWeight: '900', marginTop: 2 },
  postViewerClose: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  postViewerImage: { width: '100%', aspectRatio: 1, backgroundColor: '#071a33' },
  postViewerVideo: { width: '100%', aspectRatio: 1, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center', gap: 8 },
  postViewerVideoText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  postViewerCaption: { color: '#475569', fontSize: 13, lineHeight: 20, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
  card: { marginHorizontal: 14, backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 18 },
  panelStack: { marginHorizontal: 14, gap: 12 },
  blockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6, paddingHorizontal: 2 },
  blockTitle: { color: '#f5a623', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  whiteBlock: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 12 },
  yearbookPanel: { marginHorizontal: 14, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 },
  yearbookBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, borderWidth: 1, borderColor: '#86efac', backgroundColor: '#dcfce7', padding: 12, marginBottom: 14 },
  yearbookIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  yearbookBadgeTitle: { color: '#166534', fontSize: 13, fontWeight: '900' },
  yearbookBadgeText: { color: '#166534', fontSize: 10, fontWeight: '700', marginTop: 2 },
  yearbookLine: { borderLeftWidth: 2, borderLeftColor: '#fdb813', paddingLeft: 8, marginBottom: 12 },
  yearbookLabel: { color: '#f5a623', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 3 },
  yearbookValue: { color: '#1d2b4b', fontSize: 13, lineHeight: 18, fontWeight: '800', fontStyle: 'italic' },
  messageCard: { backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 },
  messageText: { color: '#1d2b4b', fontSize: 13, lineHeight: 19, fontWeight: '800', fontStyle: 'italic' },
  voiceWrap: { gap: 12 },
  voiceComposer: { marginHorizontal: 14, backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 16 },
  voiceComposerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 13 },
  voiceComposerIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  voiceComposerTitle: { color: '#1d2b4b', fontSize: 14, fontWeight: '900' },
  voiceComposerText: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  voiceInput: { minHeight: 44, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 13, color: '#1d2b4b', fontSize: 13, marginBottom: 12 },
  voiceActionRow: { flexDirection: 'row', gap: 10 },
  recordButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  recordButtonStop: { backgroundColor: '#dc2626' },
  recordButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  sendVoiceButton: { width: 92, minHeight: 44, borderRadius: 12, backgroundColor: '#fdb813', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  sendVoiceText: { color: '#1d2b4b', fontSize: 12, fontWeight: '900' },
  infoRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  infoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  infoLabel: { color: '#6B7280', fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  infoValue: { color: '#1A2547', fontSize: 16, fontWeight: '900', marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: '#1d2b4b', fontSize: 14, fontWeight: '900' },
  rowText: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 22, marginTop: 6 },
  waveBar: { width: 3, borderRadius: 999 },
  playButton: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  playButtonActive: { backgroundColor: '#fdb813' },
  empty: { marginHorizontal: 14, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 50, paddingHorizontal: 28, alignItems: 'center' },
  emptyCompact: { marginHorizontal: 0, borderWidth: 0, paddingVertical: 24, paddingHorizontal: 16 },
  emptyTitle: { color: '#1d2b4b', fontSize: 16, fontWeight: '900', marginTop: 14 },
  emptyText: { color: '#94a3b8', fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 6 },
});
