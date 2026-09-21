import axios from "axios";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const inferApiUrlFromExpoHost = () => {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    Constants.manifest?.debuggerHost;

  const host = typeof hostUri === "string" ? hostUri.split(":")[0] : "";
  if (Platform.OS === "web" && (!host || host === "localhost")) {
    return "http://127.0.0.1:8000/api";
  }
  return host ? `http://${host}:8000/api` : "http://127.0.0.1:8000/api";
};

export const API_BASE_URL = (() => {
  // 1. Explicit env var baked in at build time
  if (process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL !== "auto") {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, "");
  }
  // 2. app.json extra always available at runtime, works in dev and prod
  if (Constants.expoConfig?.extra?.apiUrl) {
    return Constants.expoConfig.extra.apiUrl.replace(/\/+$/, "");
  }
  // 3. Hard fallback
  return "https://yearbook-myji.onrender.com/api";
})();

const configuredAuthUrl =
  process.env.EXPO_PUBLIC_AUTH_BASE_URL || Constants.expoConfig?.extra?.authBaseUrl;

export const AUTH_BASE_URL = (configuredAuthUrl || API_BASE_URL.replace(/\/api\/?$/, "")).replace(/\/+$/, "");

export const STORAGE_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

const TOKEN_KEY = "nu_lipa_yearbook_token";
const USER_KEY = "nu_lipa_yearbook_user";

const webStorage = {
  getItemAsync: async (key) => {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  },
  setItemAsync: async (key, value) => {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  },
  deleteItemAsync: async (key) => {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(key);
  },
};

const sessionStore =
  Platform.OS === "web" || typeof SecureStore.getItemAsync !== "function"
    ? webStorage
    : SecureStore;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(async (config) => {
  const token = await sessionStore.getItemAsync(TOKEN_KEY);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await clearSession();
    }

    return Promise.reject(error);
  }
);

export const saveToken = async (token) => {
  await sessionStore.setItemAsync(TOKEN_KEY, token);
};

export const getToken = async () => sessionStore.getItemAsync(TOKEN_KEY);

export const saveCurrentUser = async (user) => {
  await sessionStore.setItemAsync(USER_KEY, JSON.stringify(user));
};

export const getCurrentUser = async () => {
  const rawUser = await sessionStore.getItemAsync(USER_KEY);

  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser);
  } catch (_error) {
    await sessionStore.deleteItemAsync(USER_KEY);
    return null;
  }
};

export const clearToken = async () => {
  await sessionStore.deleteItemAsync(TOKEN_KEY);
};

export const clearSession = async () => {
  await Promise.all([
    sessionStore.deleteItemAsync(TOKEN_KEY),
    sessionStore.deleteItemAsync(USER_KEY),
  ]);
};

export const unwrap = (response) => response?.data?.data ?? response?.data ?? response ?? [];

export const paginationMeta = (payload) => ({
  currentPage: payload?.current_page ?? payload?.meta?.current_page ?? 1,
  lastPage: payload?.last_page ?? payload?.meta?.last_page ?? 1,
});

export const getErrorMessage = (error, fallback = "Something went wrong. Please try again.") => {
  const errors = error?.response?.data?.errors;
  const firstError = errors && Object.values(errors).flat()[0];

  if (error?.message === "Network Error" || error?.message === "Network request failed") {
    return `Network Error. Check that your phone can open ${API_BASE_URL}/app-config`;
  }

  return firstError || error?.response?.data?.message || error?.message || fallback;
};

export const imageUrl = (path) => {
  if (!path) return null;
  if (typeof path === "number") return path;
  if (typeof path === "object") {
    return imageUrl(
      path.uri ||
      path.url ||
      path.file_path ||
      path.media_url ||
      path.thumbnail_url ||
      path.preview_url ||
      path.image_url ||
      path.photo_url ||
      path.path ||
      path.src
    );
  }
  if (typeof path !== "string") return null;
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("file:") ||
    path.startsWith("content:") ||
    path.startsWith("asset-library:") ||
    path.startsWith("ph:") ||
    path.startsWith("blob:")
  ) return path;
  const cleanPath = path.replace(/^\/+/, "");
  if (cleanPath.startsWith("storage/")) return `${STORAGE_BASE_URL}/${cleanPath}`;
  return `${STORAGE_BASE_URL}/storage/${cleanPath}`;
};

export const getAppConfig = async () => {
  const response = await api.get("/app-config");
  return response.data;
};

export const register = async (emailOrPayload, password = null, userDetails = {}) => {
  const payload = typeof emailOrPayload === "object"
    ? emailOrPayload
    : {
      email: emailOrPayload,
      password,
      password_confirmation: userDetails.password_confirmation || password,
      ...userDetails,
    };

  const response = await api.post("/auth/register", payload);
  const token = response.data?.token || response.data?.access_token;
  const user = response.data?.user || response.data?.data?.user;

  if (token) {
    await saveToken(token);
  }

  if (user) {
    await saveCurrentUser(user);
  }

  return response.data;
};

export const login = async (email, password) => {
  const response = await api.post("/auth/login", { email, password });
  const token = response.data?.token || response.data?.access_token;
  const user = response.data?.user || response.data?.data?.user;

  if (token) {
    await saveToken(token);
  }

  if (user) {
    await saveCurrentUser(user);
  }

  return response.data;
};

export const verifyStudent = async (payload) => {
  const response = await api.post("/auth/verify-student", payload);
  return response.data;
};

export const sendOtp = async (email) => {
  const response = await api.post("/auth/otp/send", { email });
  return response.data;
};

export const verifyOtp = async (email, otp) => {
  const response = await api.post("/auth/otp/verify", { email, otp });
  return response.data;
};

export const acceptConsent = async (version = "1.0") => {
  const response = await api.post("/consent/accept", { version });
  return response.data;
};

export const getConsentStatus = async () => {
  const response = await api.get("/consent/status");
  return response.data;
};

export const forgotPassword = async (email) => {
  const response = await api.post("/auth/forgot-password", { email });
  return response.data;
};

export const verifyResetOtp = async (email, otp) => {
  const response = await api.post("/auth/otp/verify-reset", { email, otp });
  return response.data;
};

export const resetPassword = async (payload) => {
  const response = await api.post("/auth/reset-password", payload);
  return response.data;
};

export const logout = async () => {
  try {
    await api.post("/auth/logout");
  } finally {
    await clearSession();
  }
};

export const fetchCurrentUser = async () => {
  const response = await api.get("/auth/me");
  const user = response.data?.user || response.data?.data || response.data;

  if (user) {
    await saveCurrentUser(user);
  }

  return user;
};

export const updateCurrentUser = async (payload) => {
  const requests = [];

  if (payload.name || payload.course || payload.section || payload.year_level) {
    requests.push(api.put("/profile/academic", payload));
  }

  if (payload.bio !== undefined) {
    requests.push(api.post("/students/profile/bio", { bio: payload.bio }));
  }

  if (payload.profile_pic || payload.profile_picture || payload.photo) {
    requests.push(api.post("/students/profile/photo", {
      photo: payload.profile_pic || payload.profile_picture || payload.photo,
    }));
  }

  if (!requests.length) {
    requests.push(api.put("/profile/academic", payload));
  }

  await Promise.all(requests);
  return fetchCurrentUser();
};

export const updateProfileBio = async (bio) => {
  const response = await api.post("/students/profile/bio", { bio });
  return response.data;
};

export const updateProfilePhoto = async (formData) => {
  const response = await api.post("/students/profile/photo", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const updateProfileVisibility = async (visibility) => {
  const response = await api.post("/profile/visibility", { visibility });
  return response.data;
};

export const updateProfileMotto = async (motto) => {
  const response = await api.post("/profile/motto", { motto });
  return response.data;
};

export const updateProfileAcademic = async (payload) => {
  const response = await api.put("/profile/academic", payload);
  return response.data;
};

export const updateProfileAchievements = async (achievements) => {
  const response = await api.put("/profile/achievements", { achievements });
  return response.data;
};

export const uploadProfileMedia = async (formData) => {
  const response = await api.post("/profile/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const getProfileStorageUsage = async () => {
  const response = await api.get("/profile/storage-usage");
  return response.data;
};

export const updateProfilePost = async (photoId, payload) => {
  const response = await api.patch(`/profile/posts/${photoId}`, payload);
  return response.data;
};

export const deleteProfilePost = async (photoId) => {
  const response = await api.delete(`/profile/posts/${photoId}`);
  return response.data;
};

export const updatePassword = async (payload) => {
  const response = await api.put("/students/profile/password", payload);
  return response.data;
};

export const getStudents = async (params = {}) => {
  const response = await api.get("/search/students", { params });
  return response.data;
};

export const getStudentSuggestions = async (params = {}) => {
  const response = await api.get("/search/students/suggest", { params });
  return response.data;
};

export const getStudent = async (id) => {
  const response = await api.get(`/students/${id}`);
  return response.data;
};

export const trackStudentView = async (id) => {
  const response = await api.post(`/students/${id}/view`);
  return response.data;
};

export const getStudentAchievements = async (id) => {
  const response = await api.get(`/students/${id}/achievements`);
  return response.data;
};

export const getTaggedPhotos = async (id) => {
  const response = await api.get(`/students/${id}/tagged-photos`);
  return response.data;
};

export const uploadTaggedPhoto = async (formData) => {
  const response = await api.post("/students/profile/tagged-photos/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const tagStudentsOnPost = async (payload) => {
  const response = await api.post("/students/profile/tagged-photos", payload);
  return response.data;
};

export const deleteTaggedPhoto = async (photoId) => {
  const response = await api.delete(`/students/profile/tagged-photos/${photoId}`);
  return response.data;
};

export const getProfileAchievements = async () => {
  const response = await api.get("/profile/achievements");
  return response.data;
};

export const getStudentPosts = async (id, page = 1) => {
  const response = await api.get(`/students/${id}/posts`, { params: { page } });
  return response.data;
};

export const getSearchFilters = async () => {
  const response = await api.get("/search/students/filters");
  return response.data;
};

export const getSections = async (params = {}) => {
  const response = await api.get("/sections", { params });
  return response.data;
};

export const getSection = async (id) => {
  const response = await api.get(`/sections/${id}`);
  return response.data;
};

export const getBatches = async (params = {}) => {
  const response = await api.get("/batches", { params });
  return response.data;
};

export const getBatchStudents = async (batch, params = {}) => {
  const response = await api.get(`/batches/${batch}/students`, { params });
  return response.data;
};

export const getFaculty = async (params = {}) => {
  const response = await api.get("/faculty/by-department", { params });
  return response.data;
};

export const getFacultyMember = async (id) => {
  const response = await api.get(`/faculty/${id}`);
  return response.data;
};

export const getGallery = async (params = {}) => {
  const response = await api.get("/gallery", { params });
  return response.data;
};

export const getGalleryAlbums = async (params = {}) => {
  const response = await api.get("/gallery/albums", { params });
  return response.data;
};

export const createGalleryAlbum = async (payload) => {
  const response = await api.post("/gallery/albums", payload);
  return response.data;
};

export const getGalleryAlbum = async (id) => {
  const response = await api.get(`/gallery/${id}`);
  return response.data;
};

export const bulkUploadMedia = async (formData) => {
  const response = await api.post("/media/bulk-upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const uploadMediaVideo = async (formData) => {
  const response = await api.post("/media/upload-video", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const deleteGalleryMedia = async (mediaId) => {
  const response = await api.delete(`/gallery/media/${mediaId}`);
  return response.data;
};

export const deleteMediaPhoto = async (photoId) => {
  const response = await api.delete(`/media/photo/${photoId}`);
  return response.data;
};

export const getGraduationGallery = async (params = {}) => {
  const response = await api.get("/graduation", { params });
  return response.data;
};

export const getGraduationAlbum = async (id) => {
  const response = await api.get(`/graduation/${id}`);
  return response.data;
};

export const getGraduationAlbumPhotos = async (id, params = {}) => {
  const response = await api.get(`/graduation/${id}/photos`, { params });
  return response.data;
};

export const createGraduationAlbum = async (payload) => {
  const response = await api.post("/graduation/album", payload);
  return response.data;
};

export const uploadGraduationPhoto = async (formData) => {
  const response = await api.post("/graduation/upload-photo", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const uploadGraduationVideo = async (formData) => {
  const response = await api.post("/graduation/upload-video", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const deleteGraduationAlbum = async (id) => {
  const response = await api.delete(`/graduation/${id}`);
  return response.data;
};

export const faceSearch = async (formData) => {
  const response = await api.post("/gallery/face-search", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const searchFace = async (formData) => {
  const response = await api.post("/face/search", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const getFaceStudentPhotos = async (userId, page = 1) => {
  const response = await api.get(`/face/students/${userId}/photos`, { params: { page } });
  return response.data;
};

export const getAnnouncements = async () => {
  const response = await api.get("/announcements");
  return response.data;
};

export const getFeed = async (params = {}) => {
  const response = await api.get("/feed", { params });
  return response.data;
};

export const recordFeedPostView = async (photoId) => {
  const response = await api.post(`/feed/${photoId}/view`);
  return response.data;
};

export const getBatchmates = async (params = {}) => {
  const response = await api.get("/batchmates", { params });
  return response.data;
};

export const getMemoryDigest = async (params = {}) => {
  const response = await api.get("/dashboard/memory-digest", { params });
  return response.data;
};

export const getOnThisDayMemories = async (params = {}) => {
  const response = await api.get("/memories/on-this-day", { params });
  return response.data;
};

export const searchAll = async (q, type = "all") => {
  const response = await api.get("/search", { params: { q, type } });
  return response.data;
};

export const getNotifications = async () => {
  const response = await api.get("/notifications");
  return response.data;
};

export const markNotificationRead = async (id) => {
  const response = await api.post(`/notifications/${id}/read`);
  return response.data;
};

export const markAllNotificationsRead = async () => {
  const response = await api.post("/notifications/read-all");
  return response.data;
};

export const registerNotificationToken = async (fcmToken) => {
  const response = await api.post("/notifications/register-token", { fcm_token: fcmToken });
  return response.data;
};

export const getAnalyticsSummary = async () => {
  const response = await api.get("/analytics/summary");
  return response.data;
};

export const getMyStats = async () => {
  const response = await api.get("/analytics/my-stats");
  return response.data;
};

export const getTopViewed = async (limit = 5) => {
  const response = await api.get("/analytics/top-viewed", { params: { limit } });
  return response.data;
};

export const getTrending = async () => {
  const response = await api.get("/analytics/trending");
  return response.data;
};

export const getMyStatsTrend = async (params = {}) => {
  const response = await api.get("/analytics/my-stats/trend", { params });
  return response.data;
};

export const getBatchmateAnalytics = async (params = {}) => {
  const response = await api.get("/analytics/batchmates", { params });
  return response.data;
};

export const recordContentView = async (payload) => {
  const response = await api.post("/analytics/record-content-view", payload);
  return response.data;
};

export const getYearbookBatches = async () => {
  const response = await api.get("/batches");
  return response.data;
};

export const getYearbookPages = async (batchId) => {
  const response = await api.get(`/yearbooks/${batchId}/pages`);
  return response.data;
};

export const getYearbookMeta = async (batchId) => {
  const response = await api.get(`/yearbooks/${batchId}`);
  return response.data;
};

export const getYearbookGalleries = async (batchId) => {
  const response = await api.get(`/yearbooks/${batchId}/galleries`);
  return response.data;
};

export const searchYearbook = async (batchId, q) => {
  const response = await api.get("/yearbook/search", { params: { batchId, q } });
  return response.data;
};

export const getYearbookBookmarks = async (batchId) => {
  const response = await api.get(`/yearbook/bookmarks/${batchId}`);
  return response.data;
};

export const addYearbookBookmark = async (payload) => {
  const response = await api.post("/yearbook/bookmark", {
    batchId: payload.batchId ?? payload.batch_id,
    pageIndex: payload.pageIndex ?? payload.page_index,
    label: payload.label,
  });
  return response.data;
};

export const removeYearbookBookmark = async (bookmarkId) => {
  const response = await api.delete(`/yearbook/bookmark/${bookmarkId}`);
  return response.data;
};

export const generateYearbook = async (batchId) => {
  const response = await api.post(`/yearbooks/${batchId}/generate`);
  return response.data;
};

export const getYearbookWebViewerUrl = (batchId, params = {}) => {
  const apiUrl = new URL(API_BASE_URL);
  const host = apiUrl.hostname;
  const protocol = apiUrl.protocol || "http:";
  const webPort = params.port || Constants.expoConfig?.extra?.webPort || "5173";
  const url = new URL(`${protocol}//${host}${webPort ? `:${webPort}` : ""}/yearbook/${batchId}/view`);

  Object.entries(params).forEach(([key, value]) => {
    if (key === "port" || value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
};

export const getMobileYearbookPdfUrl = async (batchId) => {
  const token = await getToken();
  if (!token) throw new Error("Please sign in again to open the PDF.");
  return `${API_BASE_URL}/yearbook/export/mobile-pdf/${batchId}?token=${encodeURIComponent(token)}&stream=1`;
};

export const getAlumni = async (params = {}) => {
  const response = await api.get("/alumni", { params });
  return response.data;
};

export const searchAlumni = async (q, params = {}) => {
  const response = await api.get("/alumni/search", { params: { q, ...params } });
  return response.data;
};

export const getAlumniMe = async () => {
  const response = await api.get("/alumni/me");
  return response.data;
};

export const updateAlumniCareer = async (payload) => {
  const response = await api.post("/alumni/career", payload);
  return response.data;
};

export const getAlumniYearbookEntry = async (id) => {
  const response = await api.get(`/alumni/${id}/yearbook-entry`);
  return response.data;
};

export const getAlumniFromYearbookPage = async (batchId, pageIndex) => {
  const response = await api.get("/alumni/from-yearbook-page", {
    params: { batch_id: batchId, page_index: pageIndex },
  });
  return response.data;
};

export const getMessagesUnreadCount = async () => {
  const response = await api.get("/messages/unread-count");
  return response.data;
};

export const getConversations = async () => {
  const response = await api.get("/messages/conversations");
  return response.data;
};

export const getMessageThread = async (userId) => {
  const response = await api.get(`/messages/${userId}`);
  return response.data;
};

export const getMessageParticipant = async (userId) => {
  const response = await api.get(`/messages/users/${userId}`);
  return response.data;
};

export const markMessageRead = async (id) => {
  const response = await api.patch(`/messages/${id}/read`);
  return response.data;
};

export const sendTypingStatus = async (receiverId, isTyping) => {
  const response = await api.post("/messages/typing", {
    receiver_id: receiverId,
    is_typing: isTyping,
  });
  return response.data;
};

export const sendMessage = async (receiverId, body, image = null) => {
  if (image?.uri) {
    const form = new FormData();
    form.append("receiver_id", String(receiverId));
    form.append("body", body || "");
    form.append("image", {
      uri: image.uri,
      name: image.fileName || `message-${Date.now()}.jpg`,
      type: image.mimeType || "image/jpeg",
    });

    const response = await api.post("/messages", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  }

  const response = await api.post("/messages", { receiver_id: receiverId, body });
  return response.data;
};

export const updatePresence = async (isOnline) => {
  const response = await api.post("/presence", { is_online: isOnline });
  return response.data;
};

export const getPresenceBulk = async (userIds = []) => {
  const response = await api.post("/presence/bulk", { user_ids: userIds });
  return response.data;
};

export const getVoiceNotesInbox = async () => {
  const response = await api.get("/voice-notes/inbox");
  return response.data;
};

export const getVoiceNotesOutbox = async () => {
  const response = await api.get("/voice-notes/outbox");
  return response.data;
};

export const getVoiceNotesForProfile = async (userId) => {
  const response = await api.get(`/voice-notes/profile/${userId}`);
  return response.data;
};

export const sendVoiceNote = async (formData) => {
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/voice-notes`);
    xhr.timeout = 60000;
    xhr.setRequestHeader("Accept", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.onload = () => {
      let data = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (_error) {
        data = { message: xhr.responseText || "Unable to send this voice memory." };
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(data?.message || "Unable to send this voice memory.");
        error.response = { status: xhr.status, data };
        reject(error);
        return;
      }

      resolve(data);
    };

    xhr.onerror = () => reject(new Error(`Network Error while uploading to ${API_BASE_URL}/voice-notes`));
    xhr.ontimeout = () => reject(new Error(`Upload timed out while sending to ${API_BASE_URL}/voice-notes`));
    xhr.send(formData);
  });
};

export const deleteVoiceNote = async (id) => {
  const response = await api.delete(`/voice-notes/${id}`);
  return response.data;
};

export const getDiscoverySectionmates = async (params = {}) => {
  const response = await api.get("/discover/sectionmates", { params });
  return response.data;
};

export const getDiscoverySchool = async (params = {}) => {
  const response = await api.get("/discover/school", { params });
  return response.data;
};

export const getDiscoveryCrossProgram = async (params = {}) => {
  const response = await api.get("/discover/cross-program", { params });
  return response.data;
};

export const getDiscoveryStudent = async (id) => {
  const response = await api.get(`/discover/students/${id}`);
  return response.data;
};

export const createPaymentIntent = async (plan, redirectUrls = {}) => {
  try {
    const response = await api.post("/billing/checkout", { plan, redirect: false, ...redirectUrls });
    return response.data;
  } catch {
    const response = await api.post("/payments/create-intent", { plan, ...redirectUrls });
    return response.data;
  }
};

export const confirmPayment = async (sessionId) => {
  const response = await api.post("/payments/confirm", { session_id: sessionId });
  return response.data;
};

export const getSubscriptionStatus = async () => {
  const response = await api.get("/payments/status");
  return response.data;
};

export const getPaymentHistory = async () => {
  const response = await api.get("/payments/history");
  return response.data;
};

export const getDiscoveryByDepartment = async (department, params = {}) => {
  const response = await api.get(`/discover/department/${encodeURIComponent(department)}`, { params });
  return response.data;
};

export const getTranscripts = async (params = {}) => {
  const response = await api.get("/transcripts", { params });
  return response.data;
};

export const getTranscript = async (id) => {
  const response = await api.get(`/transcripts/${id}`);
  return response.data;
};

export const uploadTranscript = async (formData) => {
  const response = await api.post("/transcripts", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const deleteTranscript = async (id) => {
  const response = await api.delete(`/transcripts/${id}`);
  return response.data;
};

export const getTranscriptSubtitles = async (id, format = "srt") => {
  const response = await api.get(`/transcripts/${id}/subtitles`, {
    params: { format },
    responseType: "text",
  });
  return response.data;
};

export const regenerateTranscriptNotes = async (id) => {
  const response = await api.post(`/transcripts/${id}/notes`);
  return response.data;
};

export default api;
