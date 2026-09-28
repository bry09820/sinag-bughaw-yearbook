import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { FontAwesome } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { fetchCurrentUser, getAppConfig, getErrorMessage, getSearchFilters, getStudent, getStudentAchievements, getStudentSuggestions, getStudents, getVoiceNotesForProfile, imageUrl, paginationMeta, searchFace, sendVoiceNote, unwrap } from '../../lib/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import UpgradePrompt, { hasPaidAccess } from '../../components/UpgradePrompt';

const { height } = Dimensions.get('window');
const audioUploadPart = (uri: string) => ({
  uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
  name: 'voice-memory.m4a',
  type: 'audio/m4a',
});

const COURSE_SHORT: Record<string, string> = {
  'Bachelor of Science in Architecture': 'BSArch',
  'Bachelor of Science in Civil Engineering': 'BSCE',
  'Bachelor of Science in Computer Science': 'BSCS',
  'Bachelor of Science in Information Technology': 'BSIT',
  'Bachelor of Multimedia Arts': 'BMA',
  'Bachelor of Science in Nursing': 'BSN',
  'Bachelor of Science in Medical Technology': 'BSMT',
  'Bachelor of Science in Psychology': 'BSPsy',
  'Bachelor of Science in Accountancy': 'BSA',
  'Bachelor of Science in Business Administration - Financial Management': 'BSBA-FM',
  'Bachelor of Science in Business Administration - Marketing Management': 'BSBA-MM',
  'Bachelor of Science in Tourism Management': 'BSTM',
  'Master in Management': 'MM',
  ABM: 'ABM',
  STEM: 'STEM',
  HUMSS: 'HUMSS',
};

const COURSE_FULL_BY_SHORT = Object.entries(COURSE_SHORT).reduce<Record<string, string>>((map, [full, short]) => {
  map[short.toUpperCase()] = full;
  map[short.replace(/[^a-z0-9]/gi, '').toUpperCase()] = full;
  return map;
}, {});

const normalizeCourseName = (course?: string | null) => {
  const raw = String(course || '').trim();
  if (!raw || raw.toLowerCase() === 'no program listed') return '';
  const compact = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return COURSE_FULL_BY_SHORT[raw.toUpperCase()] || COURSE_FULL_BY_SHORT[compact] || raw;
};

const COURSE_FILTERS = [
  { label: 'All Programs', value: 'All Programs' },
  ...Object.entries(COURSE_SHORT).map(([value, label]) => ({ label, value })),
];
const DEFAULT_BATCH_FILTERS = [
  { label: 'All Years', value: 'All Years' },
  ...Array.from({ length: 8 }, (_, index) => String(new Date().getFullYear() - index)).map((year) => ({ label: year, value: year })),
];

const getCourseShort = (course: string, fallback = 'Student') => COURSE_SHORT[normalizeCourseName(course)] || course || fallback;
const getStudentId = (student: any) => student?.id || student?.user_id || student?.student_id;
const getStudentName = (student: any) => student?.name || student?.full_name || `${student?.first_name || ''} ${student?.last_name || ''}`.trim() || 'Unnamed Student';
const getStudentCourse = (student: any) => normalizeCourseName(student?.course || student?.program || student?.degree);
const getStudentSection = (student: any) => student?.section?.name || student?.section_name || student?.section || 'No section';
const getStudentYear = (student: any) => student?.batch_year || student?.year_level || student?.year || student?.batch?.year || student?.graduation_year || new Date().getFullYear();
const getStudentPhoto = (student: any) => imageUrl(student?.profile_picture || student?.profile_pic || student?.photo || student?.avatar);
const getInitials = (name = '') => name.trim().split(/\s+/).map((word) => word[0]?.toUpperCase() || '').slice(0, 2).join('') || 'NU';
const getRecipientId = (student: any) =>
  student?.user_id ||
  student?.account_user_id ||
  student?.user?.id ||
  student?.student?.user_id ||
  student?.student?.account_user_id ||
  (student?.id && student?.role ? student.id : null) ||
  (student?.user_id === undefined && student?.account_user_id === undefined && !student?.student_record_id ? student?.id : null);
const faceMatchId = (match: any) => match?.user_id || match?.student_id || match?.id;
const collectOwnDirectoryIds = (user: any) => {
  const student = user?.student_record || user?.studentRecord || user?.student || {};
  return new Set(
    [
      user?.id,
      user?.user_id,
      user?.account_user_id,
      user?.student_id,
      user?.student_record_id,
      user?.studentRecordId,
      student?.id,
      student?.user_id,
      student?.student_id,
      student?.account_user_id,
    ].filter((value) => value !== undefined && value !== null && value !== '').map((value) => String(value))
  );
};
const directoryIdentityValues = (student: any) => [
  student?.id,
  student?.user_id,
  student?.account_user_id,
  student?.student_id,
  student?.student_record_id,
  student?.studentRecordId,
  student?.student?.id,
  student?.student?.user_id,
  student?.student?.student_id,
  student?.user?.id,
].filter((value) => value !== undefined && value !== null && value !== '').map((value) => String(value));
const isOwnDirectoryEntry = (student: any, ownIds: Set<string>) => ownIds.size > 0 && directoryIdentityValues(student).some((value) => ownIds.has(value));
const getAudioUrl = (note: any) => imageUrl(note?.audio_url || note?.audio_path || note?.url);
const formatDuration = (seconds?: number) => {
  if (!seconds) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const formatDate = (value?: string) => {
  if (!value) return 'Pending';
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function DirectoryScreen() {
  const router = useRouter();
  const { filter, q, batch } = useLocalSearchParams();
  const [students, setStudents] = useState<any[]>([]);
  const [courseFilters, setCourseFilters] = useState(COURSE_FILTERS);
  const [batchFilters, setBatchFilters] = useState(DEFAULT_BATCH_FILTERS);
  const [activeFilter, setActiveFilter] = useState('All Programs');
  const [activeBatchYear, setActiveBatchYear] = useState('All Years');
  const [filterSheet, setFilterSheet] = useState<null | 'program' | 'year'>(null);
  const [query, setQuery] = useState(typeof q === 'string' ? q : '');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [faceSearching, setFaceSearching] = useState(false);
  const [faceMatches, setFaceMatches] = useState<any[]>([]);
  const [matchedIds, setMatchedIds] = useState<Set<any>>(new Set());
  const [error, setError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedAchievements, setSelectedAchievements] = useState<any[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<any[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  const [voiceTitle, setVoiceTitle] = useState('Voice memory');
  const [playingVoiceId, setPlayingVoiceId] = useState<any>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [appConfig, setAppConfig] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(height)).current;
  const audioPlayerRef = useRef<any>(null);
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 300);
  const directoryEnabled = appConfig?.features?.enable_student_directory_search !== false;
  const premiumEnabled = appConfig?.features?.enable_premium_subscription !== false;
  const canOpenProfiles = !premiumEnabled || hasPaidAccess(currentUser);
  const ownDirectoryIds = useMemo(() => collectOwnDirectoryIds(currentUser), [currentUser]);

  useEffect(() => {
    let mounted = true;

    getAppConfig()
      .then((payload) => {
        if (mounted) setAppConfig(unwrap(payload));
      })
      .catch(() => {
        if (mounted) setAppConfig(null);
      });

    fetchCurrentUser()
      .then((user) => {
        if (mounted) setCurrentUser(user);
      })
      .catch(() => {
        if (mounted) setCurrentUser(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (filter && typeof filter === 'string') setActiveFilter(normalizeCourseName(filter) || filter);
  }, [filter]);

  useEffect(() => {
    if (batch && typeof batch === 'string') setActiveBatchYear(batch);
  }, [batch]);

  const clearFaceResults = () => {
    setFaceMatches([]);
    setMatchedIds(new Set());
  };

  useEffect(() => {
    let mounted = true;

    getSearchFilters()
      .then((payload) => {
        if (!mounted) return;

        const courses = Array.isArray(payload?.courses) ? payload.courses : payload?.data?.courses || [];
        const batchYears = Array.isArray(payload?.batch_years) ? payload.batch_years : payload?.data?.batch_years || [];

        if (courses.length) {
          const apiCourses = courses.map((item: any) => {
            const normalized = normalizeCourseName(item?.value || item?.label || item);
            return {
              label: getCourseShort(normalized, 'Program'),
              value: normalized || String(item?.value || item),
            };
          });
          const mergedCourses = [...COURSE_FILTERS, ...apiCourses].filter((item, index, list) => (
            list.findIndex((candidate) => normalizeCourseName(candidate.value) === normalizeCourseName(item.value)) === index
          ));
          setCourseFilters([
            { label: 'All Programs', value: 'All Programs' },
            ...mergedCourses.filter((item) => item.value !== 'All Programs'),
          ]);
        }

        if (batchYears.length) {
          const apiYears = batchYears.map((year: any) => ({ label: String(year), value: String(year) }));
          const mergedYears = [...DEFAULT_BATCH_FILTERS, ...apiYears].filter((item, index, list) => (
            list.findIndex((candidate) => candidate.value === item.value) === index
          ));
          setBatchFilters([
            { label: 'All Years', value: 'All Years' },
            ...mergedYears.filter((item) => item.value !== 'All Years').sort((a, b) => Number(b.value) - Number(a.value)),
          ]);
        }
      })
      .catch(() => {
        setCourseFilters(COURSE_FILTERS);
        setBatchFilters(DEFAULT_BATCH_FILTERS);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const loadSuggestions = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      setSuggestLoading(true);
      const payload = await getStudentSuggestions({ q: text.trim() });
      setSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  const loadStudents = useCallback(async (nextPage = 1, append = false) => {
    if (!directoryEnabled) {
      setStudents([]);
      setTotal(0);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }

    try {
      if (append) setLoadingMore(true);
      else if (!refreshing) setLoading(true);

      setError('');
      const params: any = { page: nextPage, per_page: 20 };
      if (query.trim()) params.q = query.trim();
      if (activeFilter !== 'All Programs') {
        params.course = activeFilter;
        params.course_short = getCourseShort(activeFilter);
      }
      if (activeBatchYear !== 'All Years') params.batch_year = activeBatchYear;

      const payload = await getStudents(params);
      const data = unwrap(payload);
      const meta = paginationMeta(payload);
      const nextStudents = (Array.isArray(data) ? data : [])
        .filter((student) => !isOwnDirectoryEntry(student, ownDirectoryIds))
        .filter((student, index, arr) => {
          const key = `${student?.id}-${student?.user_id}-${student?.student_id}`;
          return arr.findIndex((s) => `${s?.id}-${s?.user_id}-${s?.student_id}` === key) === index;
        });

      setStudents((current) => (append ? [...current, ...nextStudents] : nextStudents));
      const totalFromApi = Number(payload?.meta?.total || payload?.total || nextStudents.length);
      const removedOwnEntry = Array.isArray(data) && data.length !== nextStudents.length ? 1 : 0;
      setTotal(Math.max(0, totalFromApi - removedOwnEntry));
      setPage(meta.currentPage);
      setLastPage(meta.lastPage);
    } catch (requestError: any) {
      setError(getErrorMessage(requestError, 'Unable to load the student directory.'));
      if (!append) setStudents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [activeBatchYear, activeFilter, directoryEnabled, ownDirectoryIds, query, refreshing]);

  useEffect(() => {
    const timer = setTimeout(() => loadStudents(1), 350);
    return () => clearTimeout(timer);
  }, [loadStudents]);

  const handleFaceSearch = async () => {
    if (!directoryEnabled) {
      Alert.alert('Directory unavailable', 'Student directory search is currently disabled.');
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo access to search by face.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setFaceSearching(true);
      clearFaceResults();
      setSuggestions([]);
      setShowSuggestions(false);
      const asset = result.assets[0];
      const form = new FormData();
      form.append('face_image', {
        uri: asset.uri,
        name: asset.fileName || 'face-search.jpg',
        type: asset.mimeType || 'image/jpeg',
      } as any);

      const payload = await searchFace(form);
      const matches = (payload?.matches || payload?.data?.matches || [])
        .filter((match: any) => faceMatchId(match))
        .filter((match: any) => !isOwnDirectoryEntry(match, ownDirectoryIds));
      setFaceMatches(matches);
      setMatchedIds(new Set(matches.map(faceMatchId)));

      const topName = matches[0]?.name;
      if (topName) setQuery(topName);
      Haptics.notificationAsync(matches.length ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    } catch (requestError: any) {
      setError(getErrorMessage(requestError, 'Face search failed. Please try again.'));
    } finally {
      setFaceSearching(false);
    }
  };

  const toggleModal = (visible: boolean, student: any = null) => {
    if (visible) {
      setSelectedStudent(student);
      setSelectedAchievements([]);
      setVoiceNotes([]);
      setVoiceTitle('Voice memory');
      setRecordedUri(null);
      setIsModalVisible(true);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 8 }),
      ]).start();

      const id = getStudentId(student);
      if (id) {
        Promise.allSettled([getStudent(id), getStudentAchievements(id)]).then(([profileResult, achievementResult]) => {
          if (profileResult.status === 'fulfilled') setSelectedStudent((current: any) => ({ ...current, ...unwrap(profileResult.value) }));
          if (achievementResult.status === 'fulfilled') {
            const achievements = unwrap(achievementResult.value);
            setSelectedAchievements(Array.isArray(achievements) ? achievements : []);
          }
        });
        loadVoiceNotes(id);
      }
    } else {
      audioPlayerRef.current?.pause?.();
      setPlayingVoiceId(null);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: height, duration: 220, useNativeDriver: true }),
      ]).start(() => {
        setIsModalVisible(false);
        setSelectedStudent(null);
      });
    }
  };

  const handleSendMessage = async () => {
    const id = getRecipientId(selectedStudent);
    if (!id) return;
    toggleModal(false);
    router.push({ pathname: '/messages', params: { userId: String(id), name: getStudentName(selectedStudent) } } as any);
  };

  const loadVoiceNotes = async (userId: any) => {
    try {
      setVoiceLoading(true);
      const payload = await getVoiceNotesForProfile(userId);
      const data = unwrap(payload);
      setVoiceNotes(Array.isArray(data) ? data : data?.data || []);
    } catch {
      setVoiceNotes([]);
    } finally {
      setVoiceLoading(false);
    }
  };

  const handleStartRecording = async () => {
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (requestError: any) {
      Alert.alert('Recording failed', getErrorMessage(requestError, 'Unable to start recording.'));
    }
  };

  const handleStopRecording = async () => {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const status = recorder.getStatus();
      setRecordedUri(status.url || recorder.uri || null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (requestError: any) {
      Alert.alert('Recording failed', getErrorMessage(requestError, 'Unable to stop recording.'));
    }
  };

  const handleSendVoiceNote = async () => {
    const recipientId = getRecipientId(selectedStudent);
    if (!recipientId || !recordedUri) return;

    try {
      setVoiceSending(true);
      const durationSeconds = Math.max(1, Math.round((recorderState.durationMillis || 0) / 1000));
      const form = new FormData();
      form.append('recipient_id', String(recipientId));
      form.append('title', voiceTitle.trim() || 'Voice memory');
      form.append('duration_seconds', String(durationSeconds));
      form.append('audio', audioUploadPart(recordedUri) as any);

      await sendVoiceNote(form);
      setRecordedUri(null);
      setVoiceTitle('Voice memory');
      await loadVoiceNotes(recipientId);
      Alert.alert('Voice memory sent', 'Your voice note is pending approval before it appears on their profile.');
    } catch (requestError: any) {
      Alert.alert('Send failed', getErrorMessage(requestError, 'Unable to send this voice memory.'));
    } finally {
      setVoiceSending(false);
    }
  };

  const toggleVoicePlayback = async (note: any) => {
    const url = getAudioUrl(note);
    if (!url) return;

    if (playingVoiceId === note.id) {
      audioPlayerRef.current?.pause?.();
      setPlayingVoiceId(null);
      return;
    }

    audioPlayerRef.current?.pause?.();
    audioPlayerRef.current?.remove?.();
    const player = createAudioPlayer({ uri: url });
    audioPlayerRef.current = player;
    setPlayingVoiceId(note.id);
    player.play();
  };

  const selectedFilterLabel = useMemo(() => courseFilters.find((item) => item.value === activeFilter)?.label || activeFilter, [activeFilter, courseFilters]);
  const selectedYearLabel = useMemo(() => batchFilters.find((item) => item.value === activeBatchYear)?.label || activeBatchYear, [activeBatchYear, batchFilters]);
  const isFaceMode = faceMatches.length > 0;

  const selectProgramFilter = (value: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearFaceResults();
    setActiveFilter(value);
    setFilterSheet(null);
  };

  const selectYearFilter = (value: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearFaceResults();
    setActiveBatchYear(value);
    setFilterSheet(null);
  };

  const renderStudent = ({ item, index }: { item: any; index: number }) => {
    const name = getStudentName(item);
    const program = getStudentCourse(item);
    const hasProgram = Boolean(program);
    const photo = getStudentPhoto(item);
    const matched = matchedIds.has(getStudentId(item)) || matchedIds.has(item?.user_id);

    return (
      <TouchableOpacity
        style={[styles.studentCard, matched && styles.studentCardMatched]}
        activeOpacity={0.88}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const userId = getRecipientId(item);
          const studentRecordId = item?.student_record_id || item?.student?.id || item?.record?.id;
          const profileId = studentRecordId || userId || getStudentId(item);

          // Direct messaging is available to all registered students.
          // Free users can open the profile entry point to Message; full yearbook details remain soft-gated by the API.
          if (profileId) {
            router.push({
              pathname: '/student/[id]',
              params: {
                id: String(profileId),
                ...(userId ? { userId: String(userId) } : {}),
                ...(studentRecordId ? { studentRecordId: String(studentRecordId) } : {}),
                source: 'directory',
                name,
                ...(hasProgram ? { course: program } : {}),
                year: String(getStudentYear(item) || ''),
                section: getStudentSection(item),
                studentNo: String(item?.student_no || item?.student_id || ''),
                email: String(item?.email || ''),
                ...(photo ? { photo } : {}),
              },
            } as any);
          } else {
            toggleModal(true, item);
          }
        }}
      >
        <View style={styles.photoArea}>
          {photo ? <Image source={photo} style={styles.cardPhoto} contentFit="cover" /> : (
            <View style={styles.initialsArea}>
              <Text style={styles.initialsText}>{getInitials(name)}</Text>
            </View>
          )}
          {matched ? (
            <View style={styles.matchBadge}>
              <FontAwesome name="camera" size={9} color="#1d2b4b" />
              <Text style={styles.matchText}>match</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {hasProgram ? <Text style={styles.studentMeta} numberOfLines={1}>{program}</Text> : null}
          <View style={styles.studentMetaRow}>
            {hasProgram ? (
              <View style={styles.courseBadge}>
                <Text style={styles.courseBadgeText}>{getCourseShort(program).toUpperCase()}</Text>
              </View>
            ) : null}
            <View style={styles.yearBadge}>
              <FontAwesome name="graduation-cap" size={9} color="#9a6100" />
              <Text style={styles.batchText}>{getStudentYear(item)}</Text>
            </View>
          </View>
        </View>
        <View style={styles.profileButton}>
          <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
        </View>
      </TouchableOpacity>
    );
  };

  if (!directoryEnabled) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <StatusBar style="dark" />
        <View style={styles.unavailableWrap}>
          <View style={styles.unavailableIcon}>
            <FontAwesome name="lock" size={24} color="#fdb813" />
          </View>
          <Text style={styles.unavailableTitle}>Directory Unavailable</Text>
          <Text style={styles.unavailableText}>
            Student directory search is currently disabled by platform settings.
          </Text>
          <TouchableOpacity style={styles.unavailableButton} onPress={() => router.replace('/(tabs)/home' as any)}>
            <FontAwesome name="home" size={14} color="#1d2b4b" />
            <Text style={styles.unavailableButtonText}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar style="dark" />
      <FlatList
        data={students}
        // FIX 1: Composite+index key so duplicate records from the API never collide.
        keyExtractor={(item, index) => {
          const composite = `${item?.id ?? ''}-${item?.user_id ?? ''}-${item?.student_id ?? ''}`;
          return composite !== '--' ? `student-${composite}-${index}` : `student-idx-${index}`;
        }}
        renderItem={renderStudent}
        ListHeaderComponent={(
          <>
            <View style={styles.directoryHeader}>
              <View>
                <Text style={styles.headerKicker}>Directory</Text>
                <Text style={styles.headerTitle}>Students</Text>
              </View>
            </View>

            {premiumEnabled && !canOpenProfiles ? (
              <TouchableOpacity
                style={styles.upgradeBanner}
                activeOpacity={0.9}
                onPress={() => setUpgradeVisible(true)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.upgradeTitle}>Unlock full directory profiles</Text>
                  <Text style={styles.upgradeText}>
                    Free accounts can browse and message classmates. Upgrade for full yearbook details.
                  </Text>
                </View>
                <View style={styles.upgradeButton}>
                  <Text style={styles.upgradeButtonText}>Upgrade</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            <View style={styles.searchArea}>
              <View style={styles.searchContainer}>
                    <FontAwesome name="search" size={16} color="#94a3b8" style={styles.searchIcon} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder={isFaceMode ? 'Showing face match results...' : 'Search names, student IDs, or programs...'}
                      placeholderTextColor="#94a3b8"
                      value={query}
                      onChangeText={(value) => {
                        setQuery(value);
                        setShowSuggestions(true);
                        clearFaceResults();
                        if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
                        suggestionTimer.current = setTimeout(() => loadSuggestions(value), 150);
                      }}
                      onFocus={() => setShowSuggestions(true)}
                    />
                    <TouchableOpacity style={styles.searchCameraButton} onPress={handleFaceSearch} disabled={faceSearching}>
                      {faceSearching ? <ActivityIndicator color="#F5A623" size="small" /> : <FontAwesome name="camera" size={15} color="#F5A623" />}
                    </TouchableOpacity>
              </View>
                {showSuggestions && suggestions.length ? (
                  <View style={styles.suggestionBox}>
                    {/* FIX 2: Guard against null/undefined id on suggestion items */}
                    {suggestions.map((item, index) => (
                      <TouchableOpacity
                        key={`suggestion-${item.id ?? index}`}
                        style={styles.suggestionRow}
                        onPress={() => {
                          setQuery(item.name || '');
                          setSuggestions([]);
                          setShowSuggestions(false);
                          clearFaceResults();
                        }}
                      >
                        {item.profile_picture ? (
                          <Image source={imageUrl(item.profile_picture)} style={styles.suggestionAvatar} contentFit="cover" />
                        ) : (
                          <View style={styles.suggestionInitials}>
                            <Text style={styles.suggestionInitialsText}>{getInitials(item.name)}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.suggestionMeta} numberOfLines={1}>{item.student_id || 'Student'} - {item.course_short || 'Program'}</Text>
                        </View>
                        <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : suggestLoading ? (
                  <View style={styles.suggestionLoading}>
                    <ActivityIndicator color="#fdb813" size="small" />
                    <Text style={styles.suggestionLoadingText}>Finding students...</Text>
                  </View>
                ) : null}
                {isFaceMode ? (
                  <View style={styles.faceBanner}>
                    <Text style={styles.faceBannerText}>{faceMatches.length} face match{faceMatches.length > 1 ? 'es' : ''} found</Text>
                    <TouchableOpacity onPress={() => { clearFaceResults(); setQuery(''); }}>
                      <Text style={styles.clearFaceText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
            </View>

            <View style={styles.dropdownFilterBar}>
              <TouchableOpacity style={[styles.dropdownPill, styles.programDropdown]} activeOpacity={0.88} onPress={() => setFilterSheet('program')}>
                <View style={styles.dropdownTextWrap}>
                  <Text style={styles.programDropdownLabel}>Program</Text>
                  <Text style={styles.programDropdownValue} numberOfLines={1}>{selectedFilterLabel}</Text>
                </View>
                <FontAwesome name="chevron-down" size={12} color="#1A2547" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dropdownPill, styles.yearDropdown]} activeOpacity={0.88} onPress={() => setFilterSheet('year')}>
                <View style={styles.dropdownTextWrap}>
                  <Text style={styles.yearDropdownLabel}>Year</Text>
                  <Text style={styles.yearDropdownValue} numberOfLines={1}>{selectedYearLabel}</Text>
                </View>
                <FontAwesome name="chevron-down" size={12} color="#F5A623" />
              </TouchableOpacity>
            </View>

            {!loading ? (
              <Text style={styles.resultCount}>
                {isFaceMode ? 'Showing ' : query ? 'Found ' : 'Showing '}
                <Text style={styles.resultStrong}>{isFaceMode ? faceMatches.length : total}</Text>
                {isFaceMode ? ' face matches' : query ? ` results for "${query}"` : ` students${activeFilter !== 'All Programs' ? ` in ${selectedFilterLabel}` : ''}${activeBatchYear !== 'All Years' ? ` from ${activeBatchYear}` : ''}`}
              </Text>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </>
        )}
        ListEmptyComponent={loading ? <ActivityIndicator color="#1d2b4b" style={{ marginTop: 34 }} /> : (
          <View style={styles.emptyContainer}>
            <FontAwesome name="user-times" size={42} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No Students Found</Text>
            <Text style={styles.emptyText}>Try adjusting your search or filters.</Text>
          </View>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator color="#1d2b4b" style={{ marginVertical: 20 }} /> : <View style={{ height: 110 }} />}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadStudents(1); }} />}
        onEndReached={() => {
          if (!loadingMore && page < lastPage) loadStudents(page + 1, true);
        }}
      />

      <Modal transparent visible={Boolean(filterSheet)} animationType="fade" onRequestClose={() => setFilterSheet(null)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setFilterSheet(null)} />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{filterSheet === 'program' ? 'Filter by program' : 'Filter by year'}</Text>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              {(filterSheet === 'program' ? courseFilters : batchFilters).map((item) => {
                const selected = filterSheet === 'program' ? activeFilter === item.value : activeBatchYear === item.value;
                return (
                  <TouchableOpacity
                    key={`${filterSheet}-${item.value}`}
                    style={styles.sheetOption}
                    onPress={() => filterSheet === 'program' ? selectProgramFilter(item.value) : selectYearFilter(item.value)}
                    activeOpacity={0.84}
                  >
                    <Text style={styles.sheetOptionText} numberOfLines={1}>{item.label}</Text>
                    <View style={[styles.optionCircle, selected && styles.optionCircleSelected]}>
                      {selected ? <FontAwesome name="check" size={11} color="#1A2547" /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.applyButton} onPress={() => setFilterSheet(null)}>
              <Text style={styles.applyButtonText}>Apply filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isModalVisible} transparent animationType="none" onRequestClose={() => toggleModal(false)}>
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: fadeAnim }]}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => toggleModal(false)} />
          </Animated.View>

          <Animated.View style={[styles.modalContainer, { transform: [{ translateY: slideAnim }] }]}>
            <FlatList
              data={selectedAchievements}
              // FIX 1 (modal list): same namespaced key pattern for achievements
              keyExtractor={(item, index) => `achievement-${item?.id ?? index}`}
              ListHeaderComponent={(
                <View style={styles.profileModalContent}>
                  <View style={styles.blueHeader} />
                  <View style={styles.profileInfoSection}>
                    {getStudentPhoto(selectedStudent) ? <Image source={getStudentPhoto(selectedStudent)} style={styles.largeAvatar} contentFit="cover" /> : (
                      <View style={[styles.largeAvatar, styles.avatarFallback]}>
                        <Text style={styles.largeAvatarFallbackText}>{getInitials(getStudentName(selectedStudent))}</Text>
                      </View>
                    )}
                    <Text style={styles.userName}>{getStudentName(selectedStudent)}</Text>
                    {getStudentCourse(selectedStudent) ? <Text style={styles.userDegree}>{getStudentCourse(selectedStudent)}</Text> : null}
                    <Text style={styles.userYear}>{getStudentYear(selectedStudent)} - {getStudentSection(selectedStudent)}</Text>
                    <View style={styles.actionButtons}>
                      <TouchableOpacity style={styles.primaryActionButton} onPress={handleSendMessage}>
                        <Text style={styles.primaryActionButtonText}>Message</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.voiceActionButton} onPress={recorderState.isRecording ? handleStopRecording : handleStartRecording}>
                        <FontAwesome name={recorderState.isRecording ? 'stop' : 'microphone'} size={14} color="#1d2b4b" />
                        <Text style={styles.voiceActionButtonText}>{recorderState.isRecording ? 'Stop' : 'Voice'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.contentSection}>
                    <View style={styles.sectionHeader}>
                      <FontAwesome name="book" size={16} color="#1d2b4b" style={{ marginRight: 10 }} />
                      <Text style={styles.sectionTitle}>ABOUT</Text>
                    </View>
                    <Text style={styles.aboutText}>{selectedStudent?.bio || selectedStudent?.motto || 'No bio has been added yet.'}</Text>
                    <View style={[styles.sectionHeader, { marginTop: 30 }]}>
                      <FontAwesome name="bookmark-o" size={16} color="#1d2b4b" style={{ marginRight: 10 }} />
                      <Text style={styles.sectionTitle}>ACHIEVEMENTS</Text>
                    </View>
                  </View>
                </View>
              )}
              renderItem={({ item }) => (
                <View style={[styles.achievementCardYellow, { marginHorizontal: 24 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.achievementTitleYellow}>{item?.title || item?.name || 'Achievement'}</Text>
                    <Text style={styles.achievementSubYellow}>{item?.description || item?.date || item?.year || 'Student achievement'}</Text>
                  </View>
                  <FontAwesome name="bookmark-o" size={18} color="#A67C00" />
                </View>
              )}
              ListEmptyComponent={<Text style={[styles.emptyText, { paddingHorizontal: 24 }]}>No achievements listed.</Text>}
              ListFooterComponent={(
                <View style={styles.voiceSection}>
                  <View style={styles.sectionHeader}>
                    <FontAwesome name="microphone" size={16} color="#1d2b4b" style={{ marginRight: 10 }} />
                    <Text style={styles.sectionTitle}>VOICE MEMORIES</Text>
                  </View>

                  <View style={styles.voiceComposer}>
                    <View style={styles.voiceComposerTop}>
                      <View style={styles.voiceIconCircle}>
                        <FontAwesome name={recorderState.isRecording ? 'circle' : 'microphone'} size={18} color="#fdb813" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.voiceComposerTitle}>{recordedUri ? 'Recording ready' : recorderState.isRecording ? 'Recording voice memory' : 'Send a voice memory'}</Text>
                        <Text style={styles.voiceComposerMeta}>
                          {recorderState.isRecording || recordedUri ? formatDuration(Math.round((recorderState.durationMillis || 0) / 1000)) || '0:00' : 'Audio dedications are reviewed before delivery.'}
                        </Text>
                      </View>
                    </View>

                    <TextInput
                      style={styles.voiceTitleInput}
                      value={voiceTitle}
                      onChangeText={setVoiceTitle}
                      placeholder="Voice memory title"
                      placeholderTextColor="#94a3b8"
                    />

                    <View style={styles.voiceButtonRow}>
                      <TouchableOpacity style={[styles.recordButton, recorderState.isRecording && styles.stopButton]} onPress={recorderState.isRecording ? handleStopRecording : handleStartRecording}>
                        <FontAwesome name={recorderState.isRecording ? 'stop' : 'microphone'} size={14} color={recorderState.isRecording ? '#ffffff' : '#fdb813'} />
                        <Text style={[styles.recordButtonText, recorderState.isRecording && styles.stopButtonText]}>{recorderState.isRecording ? 'Stop Recording' : recordedUri ? 'Re-record' : 'Start Recording'}</Text>
                      </TouchableOpacity>

                      {recordedUri ? (
                        <TouchableOpacity style={styles.sendVoiceButton} onPress={handleSendVoiceNote} disabled={voiceSending}>
                          {voiceSending ? <ActivityIndicator color="#1d2b4b" size="small" /> : <FontAwesome name="paper-plane" size={14} color="#1d2b4b" />}
                          <Text style={styles.sendVoiceButtonText}>Send</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>

                  {voiceLoading ? (
                    <ActivityIndicator color="#1d2b4b" style={{ marginTop: 20 }} />
                  ) : voiceNotes.length ? (
                    voiceNotes.map((note) => {
                      const playing = playingVoiceId === note.id;
                      return (
                        <View key={`voice-note-${note.id}`} style={styles.voiceNoteCard}>
                          <View style={styles.voiceNoteInfo}>
                            <Text style={styles.voiceNoteTitle} numberOfLines={1}>{note.title || 'Voice memory'}</Text>
                            <Text style={styles.voiceNoteMeta}>
                              From {note?.sender?.name || 'Classmate'} · {formatDate(note.created_at)}
                              {formatDuration(note.duration_seconds) ? ` · ${formatDuration(note.duration_seconds)}` : ''}
                            </Text>
                            {/* FIX 3: Namespace wave bar keys per note to avoid .$1 collisions */}
                            <View style={styles.waveRow}>
                              {Array.from({ length: 18 }, (_, i) => (
                                <View
                                  key={`wave-${note.id}-${i}`}
                                  style={[styles.waveBar, { height: 7 + Math.abs(Math.sin(i * 0.8)) * 12, backgroundColor: playing ? '#fdb813' : '#e2e8f0' }]}
                                />
                              ))}
                            </View>
                          </View>
                          <TouchableOpacity style={[styles.playVoiceButton, playing && styles.playVoiceButtonActive]} onPress={() => toggleVoicePlayback(note)}>
                            <FontAwesome name={playing ? 'pause' : 'play'} size={14} color={playing ? '#1d2b4b' : '#fdb813'} />
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  ) : (
                    <View style={styles.voiceEmpty}>
                      <FontAwesome name="microphone-slash" size={28} color="#cbd5e1" />
                      <Text style={styles.voiceEmptyTitle}>No voice memories yet</Text>
                      <Text style={styles.voiceEmptyText}>Be the first to send a message they can keep.</Text>
                    </View>
                  )}
                </View>
              )}
            />
          </Animated.View>
        </View>
      </Modal>

      <UpgradePrompt
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        title="Unlock Directory Profiles"
        featureLabel="full student profiles and directory details"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F8' },
  scrollContent: { paddingBottom: 0, paddingTop: 0 },
  directoryHeader: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerKicker: { color: '#F5A623', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  headerTitle: { color: '#1A2547', fontSize: 24, fontWeight: '900', marginTop: 0 },
  upgradeBanner: {
    marginHorizontal: 18,
    marginBottom: 4,
    marginTop: 4,
    borderRadius: 16,
    backgroundColor: '#263187',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  upgradeTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  upgradeText: { color: '#d8dff4', fontSize: 11, marginTop: 2 },
  upgradeButton: {
    height: 38,
    borderRadius: 11,
    backgroundColor: '#fdb813',
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeButtonText: { color: '#102044', fontSize: 11, fontWeight: '900' },
  headerCameraButton: { width: 42, height: 42, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(253,184,19,0.28)' },
  searchArea: { paddingHorizontal: 18, paddingTop: 14 },
  hero: { minHeight: 360, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(29,43,75,0.9)' },
  dotPattern: { ...StyleSheet.absoluteFillObject, opacity: 0.05, backgroundColor: 'transparent' },
  heroContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 36, paddingBottom: 30 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(253,184,19,0.15)', borderWidth: 1, borderColor: 'rgba(253,184,19,0.35)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, marginBottom: 14 },
  heroBadgeText: { color: '#fdb813', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  heroTitle: { color: '#ffffff', fontSize: 32, lineHeight: 38, fontWeight: '900', textAlign: 'center' },
  heroTitleGold: { color: '#fdb813' },
  heroSubtitle: { color: 'rgba(255,255,255,0.74)', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 24, maxWidth: 340 },
  searchShell: { width: '100%', borderRadius: 17, padding: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderRadius: 12, backgroundColor: '#F3F4F6', paddingHorizontal: 14 },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, color: '#1A2547', fontSize: 15 },
  searchCameraButton: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cameraButton: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: '#fdb813', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  faceBanner: { marginTop: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(253,184,19,0.4)', backgroundColor: 'rgba(253,184,19,0.12)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  faceBannerText: { color: '#fdb813', fontSize: 12, fontWeight: '800' },
  clearFaceText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  suggestionBox: { width: '100%', marginTop: 10, borderRadius: 16, overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  suggestionRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  suggestionAvatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#eef2ff' },
  suggestionInitials: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  suggestionInitialsText: { color: '#fdb813', fontSize: 12, fontWeight: '900' },
  suggestionName: { color: '#1d2b4b', fontSize: 13, fontWeight: '900' },
  suggestionMeta: { color: '#8fa0bf', fontSize: 11, marginTop: 2 },
  suggestionLoading: { marginTop: 10, alignSelf: 'stretch', borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  suggestionLoadingText: { color: '#64748b', fontSize: 12, fontWeight: '800' },
  dropdownFilterBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  dropdownPill: { flex: 1, minHeight: 52, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownTextWrap: { flex: 1, minWidth: 0, marginRight: 8 },
  programDropdown: { backgroundColor: '#F5A623' },
  yearDropdown: { backgroundColor: '#1A2547' },
  programDropdownLabel: { color: '#1A2547', fontSize: 11, fontWeight: '900' },
  programDropdownValue: { color: '#1A2547', fontSize: 13, fontWeight: '900', marginTop: 3 },
  yearDropdownLabel: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  yearDropdownValue: { color: '#F5A623', fontSize: 13, fontWeight: '900', marginTop: 3 },
  filtersWrap: { paddingTop: 12, paddingHorizontal: 18, paddingBottom: 4, gap: 10 },
  chipRow: { gap: 8, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  chipRowSecondary: { gap: 8, paddingHorizontal: 18, paddingBottom: 8 },
  filterChip: { height: 32, borderRadius: 12, borderWidth: 1, borderColor: '#1A2547', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  filterChipActive: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  filterChipText: { color: '#1A2547', fontSize: 12, fontWeight: '900' },
  filterChipTextActive: { color: '#ffffff' },
  filterContent: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  filterPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  activeFilterPill: { backgroundColor: '#3f51b5', borderColor: '#3f51b5' },
  filterText: { color: '#1d2b4b', fontSize: 12, fontWeight: '900' },
  activeFilterText: { color: '#ffffff' },
  resultCount: { color: '#94a3b8', fontSize: 12, marginHorizontal: 18, marginTop: 12, marginBottom: 12 },
  resultStrong: { color: '#1d2b4b', fontWeight: '900' },
  errorText: { color: '#dc2626', textAlign: 'center', marginHorizontal: 20, marginBottom: 16 },
  columnWrapper: { paddingHorizontal: 14, gap: 12 },
  studentCard: { backgroundColor: '#ffffff', borderRadius: 16, marginHorizontal: 18, marginBottom: 10, borderWidth: 1, borderColor: '#dbe3ef', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, flexDirection: 'row', alignItems: 'center', padding: 10 },
  leftCard: { marginRight: 0 },
  rightCard: { marginLeft: 0 },
  studentCardMatched: { borderColor: '#fdb813', borderWidth: 2 },
  photoArea: { width: 58, height: 58, borderRadius: 16, backgroundColor: '#1d2b4b', position: 'relative', overflow: 'hidden' },
  cardPhoto: { width: '100%', height: '100%' },
  initialsArea: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d2b4b' },
  initialsText: { color: '#fdb813', fontSize: 18, fontWeight: '900' },
  batchBadge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(29,43,75,0.86)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  batchText: { color: '#9a6100', fontSize: 10, fontWeight: '900' },
  matchBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fdb813', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  matchText: { color: '#1d2b4b', fontSize: 10, fontWeight: '900' },
  cardInfo: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: 12 },
  name: { color: '#1d2b4b', fontSize: 14, fontWeight: '900', marginBottom: 3, textTransform: 'capitalize' },
  studentMeta: { color: '#64748b', fontSize: 11, marginBottom: 7 },
  studentMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  courseBadge: { backgroundColor: '#eef2ff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  courseBadgeText: { color: '#3f51b5', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  missingProgramText: { color: '#6B7280', fontSize: 10, fontWeight: '900' },
  yearBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff3c4', borderWidth: 1, borderColor: '#ffe08a', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  profileButton: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { marginHorizontal: 18, backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 54, alignItems: 'center' },
  emptyTitle: { color: '#1d2b4b', fontSize: 18, fontWeight: '900', marginTop: 16 },
  emptyText: { color: '#8E8E93', fontSize: 14, textAlign: 'center', marginTop: 6 },
  unavailableWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  unavailableIcon: { width: 66, height: 66, borderRadius: 20, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  unavailableTitle: { color: '#1d2b4b', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  unavailableText: { color: '#64748b', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  unavailableButton: { minHeight: 46, borderRadius: 14, backgroundColor: '#fdb813', paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  unavailableButtonText: { color: '#1d2b4b', fontSize: 13, fontWeight: '900' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  filterSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26, maxHeight: '82%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 999, backgroundColor: '#D1D5E0', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: '#1A2547', fontSize: 13, fontWeight: '900', marginBottom: 4 },
  sheetScroll: { maxHeight: 430 },
  sheetOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: '#F0F2F7', gap: 12 },
  sheetOptionText: { flex: 1, color: '#1A2547', fontSize: 13, fontWeight: '700' },
  optionCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5E0', alignItems: 'center', justifyContent: 'center' },
  optionCircleSelected: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  applyButton: { height: 48, borderRadius: 12, backgroundColor: '#1A2547', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  applyButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  absoluteFill: { ...StyleSheet.absoluteFillObject },
  modalContainer: { backgroundColor: 'white', borderTopLeftRadius: 16, borderTopRightRadius: 16, height: height * 0.9, overflow: 'hidden' },
  profileModalContent: { flex: 1 },
  blueHeader: { height: 150, backgroundColor: '#1d2b4b', width: '100%' },
  profileInfoSection: { alignItems: 'center', marginTop: -70, paddingHorizontal: 24 },
  largeAvatar: { width: 140, height: 140, borderRadius: 70, borderWidth: 6, borderColor: '#FFFFFF', backgroundColor: '#eef2ff', marginBottom: 20 },
  avatarFallback: { backgroundColor: '#1d2b4b', justifyContent: 'center', alignItems: 'center' },
  largeAvatarFallbackText: { color: '#fdb813', fontSize: 44, fontWeight: '900' },
  userName: { fontSize: 26, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 6, textAlign: 'center' },
  userDegree: { fontSize: 16, color: '#1d2b4b', fontWeight: '500', marginBottom: 4, textAlign: 'center' },
  userYear: { fontSize: 14, color: '#8E8E93', marginBottom: 20 },
  actionButtons: { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 30 },
  primaryActionButton: { flex: 1, height: 50, backgroundColor: '#1d2b4b', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  primaryActionButtonText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  voiceActionButton: { width: 96, height: 50, backgroundColor: '#fdb813', borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 7 },
  voiceActionButtonText: { color: '#1d2b4b', fontWeight: '900', fontSize: 13 },
  contentSection: { paddingHorizontal: 24, paddingBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#1C1C1E', letterSpacing: 0.5 },
  aboutText: { fontSize: 14, color: '#4A4A4A', lineHeight: 22 },
  achievementCardYellow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff8e1', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#FFF1B8' },
  achievementTitleYellow: { fontSize: 15, fontWeight: 'bold', color: '#874D00', marginBottom: 2 },
  achievementSubYellow: { fontSize: 12, color: '#A67C00' },
  voiceSection: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 44 },
  voiceComposer: { backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, marginBottom: 16, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.05, shadowRadius: 14, elevation: 2 },
  voiceComposerTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  voiceIconCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  voiceComposerTitle: { color: '#1d2b4b', fontSize: 15, fontWeight: '900' },
  voiceComposerMeta: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  voiceTitleInput: { height: 44, borderRadius: 12, backgroundColor: '#f4f7fe', borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 13, color: '#1d2b4b', fontSize: 13, marginBottom: 12 },
  voiceButtonRow: { flexDirection: 'row', gap: 10 },
  recordButton: { flex: 1, height: 44, borderRadius: 12, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  stopButton: { backgroundColor: '#dc2626' },
  recordButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  stopButtonText: { color: '#ffffff' },
  sendVoiceButton: { width: 92, height: 44, borderRadius: 12, backgroundColor: '#fdb813', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  sendVoiceButtonText: { color: '#1d2b4b', fontSize: 12, fontWeight: '900' },
  voiceNoteCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 15, marginBottom: 12 },
  voiceNoteInfo: { flex: 1, minWidth: 0 },
  voiceNoteTitle: { color: '#1d2b4b', fontSize: 14, fontWeight: '900' },
  voiceNoteMeta: { color: '#94a3b8', fontSize: 11, marginTop: 4 },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 22, marginTop: 8 },
  waveBar: { width: 3, borderRadius: 999 },
  playVoiceButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#1d2b4b', alignItems: 'center', justifyContent: 'center' },
  playVoiceButtonActive: { backgroundColor: '#fdb813' },
  voiceEmpty: { backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 34, paddingHorizontal: 20, alignItems: 'center' },
  voiceEmptyTitle: { color: '#1d2b4b', fontSize: 15, fontWeight: '900', marginTop: 12 },
  voiceEmptyText: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginTop: 5 },
});