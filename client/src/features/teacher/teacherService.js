// /client/src/features/teacher/teacherService.js
import api from '../../api/axios';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryAfterDelay = (error) => {
  const retryAfterHeader = error?.response?.headers?.['retry-after'];
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return null;
};

const postWith503Retry = async (url, payload, options = {}) => {
  const {
    maxRetries = 3,
    baseDelayMs = 3000,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await api.post(url, payload);
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const isRetryable = status === 503;

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const retryAfterDelay = getRetryAfterDelay(error);
      const fallbackDelay = baseDelayMs * (attempt + 1);
      await sleep(retryAfterDelay || fallbackDelay);
    }
  }

  throw new Error('Request failed after retries.');
};

// Pings the server to wake it from Render free-tier sleep before heavy requests
const wakeUpServer = async () => {
  try {
    await api.get('/api/health', { timeout: 15000 });
  } catch (_) {
    // Ignore errors — purpose is just to trigger cold-start wake-up
  }
};

const getMyLessonNotes = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const response = await api.get(`/api/teacher/lesson-notes${queryString ? `?${queryString}` : ''}`);
  return response.data;
};

// ✅ FIX: Changed from /generate-note to /ai/generate-note
const generateLessonNote = async (noteData) => {
  return postWith503Retry('/api/teacher/ai/generate-note', noteData);
};

const getLessonNoteById = async (noteId) => {
  const response = await api.get(`/api/teacher/lesson-notes/${noteId}`);
  return response.data;
};

const deleteLessonNote = async (noteId) => {
  const response = await api.delete(`/api/teacher/lesson-notes/${noteId}`);
  return response.data;
};

// ✅ FIX: Changed from /generate-learner-note to /ai/generate-learner-note
const generateLearnerNote = async (lessonNoteId) => {
  return postWith503Retry('/api/teacher/ai/generate-learner-note', { lessonNoteId }, {
    maxRetries: 2,
    baseDelayMs: 1800,
  });
};

// generate learner note based on a curriculum strand/sub-strand
const generateLearnerNoteFromStrand = async (payload) => {
  return postWith503Retry('/api/teacher/ai/generate-learner-note-from-strand', payload, {
    maxRetries: 3,
    baseDelayMs: 2000,
  });
};

const getTeacherAnalytics = async () => {
  const response = await api.get('/api/teacher/analytics');
  return response.data;
};

const getSchoolCalendar = async () => {
  const response = await api.get('/api/teacher/school-calendar');
  return response.data;
};

const getDraftLearnerNotes = async () => {
  const response = await api.get('/api/teacher/learner-notes/drafts');
  return response.data;
};

const publishLearnerNote = async (noteId) => {
  const response = await api.put(`/api/teacher/learner-notes/${noteId}/publish`);
  return response.data;
};

const deleteLearnerNote = async (noteId) => {
  const response = await api.delete(`/api/teacher/learner-notes/${noteId}`);
  return response.data;
};

// ✅ FIX: Updated quiz generation route (check your backend for correct path)
const generateAiQuiz = async (quizData) => {
  // route defined in server/routes/quizRoutes.js as POST /api/quizzes/ai/generate
  // quizData should contain topic, subjectName, className, numQuestions etc.
  // optionally a subjectId can be supplied (preferred) and/or subStrandId
  // to allow the server to look up and store the proper ObjectId instead of a
  // plain string.
  const response = await api.post('/api/quizzes/ai/generate', quizData);
  return response.data;
};

const getAiInsights = async () => {
  try {
    const response = await api.get('/api/teacher/insights');
    return response.data;
  } catch (err) {
    console.error('AI Insights fetch failed:', err.message);
    return {
      message: 'AI insights unavailable at this moment. Try again later.',
      summary: '',
    };
  }
};

// ✅ NEW: Generate complete lesson bundle (Teacher Note + Learner Note + Quiz)
const generateLessonBundle = async (bundleData) => {
  return postWith503Retry('/api/teacher/ai/generate-lesson-bundle', bundleData, {
    maxRetries: 3,
    baseDelayMs: 2200,
  });
};

// ✅ NEW: Bundle CRUD operations
const getMyBundles = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const response = await api.get(`/api/teacher/bundles${queryString ? `?${queryString}` : ''}`);
  return response.data;
};

const getBundleById = async (bundleId) => {
  const response = await api.get(`/api/teacher/bundles/${bundleId}`);
  return response.data;
};

const updateBundle = async ({ bundleId, bundleData }) => {
  const response = await api.put(`/api/teacher/bundles/${bundleId}`, bundleData);
  return response.data;
};

const deleteBundle = async (bundleId) => {
  const response = await api.delete(`/api/teacher/bundles/${bundleId}`);
  return response.data;
};

const duplicateBundle = async (bundleId) => {
  const response = await api.post(`/api/teacher/bundles/${bundleId}/duplicate`);
  return response.data;
};

const getMyQuizzes = async () => {
  const response = await api.get('/api/quizzes');
  return response.data;
};

const getDownloadPricing = async () => {
  const response = await api.get('/api/payments/download-pricing');
  return response.data;
};

const chargeDownload = async (payload) => {
  const response = await api.post('/api/payments/downloads/charge', payload);
  return response.data;
};

const initializeDownloadPayment = async (payload) => {
  const response = await api.post('/api/payments/downloads/initialize', payload);
  return response.data;
};

const initializeBulkDownloadPayment = async (payload) => {
  const response = await api.post('/api/payments/downloads/bulk/initialize', payload);
  return response.data;
};

const verifyDownloadPayment = async (payload) => {
  const response = await api.post('/api/payments/downloads/verify', payload);
  return response.data;
};

const verifyBulkDownloadPayment = async (payload) => {
  const response = await api.post('/api/payments/downloads/bulk/verify', payload);
  return response.data;
};

const deleteQuiz = async (quizId) => {
  const response = await api.delete(`/api/quizzes/${quizId}`);
  return response.data;
};

const teacherService = {
  getMyLessonNotes,
  generateLessonNote,
  getLessonNoteById,
  deleteLessonNote,
  generateLearnerNote,
  generateLearnerNoteFromStrand,
  getTeacherAnalytics,
  getSchoolCalendar,
  getDraftLearnerNotes,
  publishLearnerNote,
  deleteLearnerNote,
  generateAiQuiz,
  getAiInsights,
  generateLessonBundle, // ✅ NEW: Bundle generation
  getMyBundles,
  getBundleById,
  updateBundle,
  deleteBundle,
  duplicateBundle,
  getMyQuizzes,
  getDownloadPricing,
  chargeDownload,
  initializeDownloadPayment,
  initializeBulkDownloadPayment,
  verifyDownloadPayment,
  verifyBulkDownloadPayment,
  deleteQuiz,

  // retrieve single quiz with populated questions/options
  getQuizById: async (quizId) => {
    const response = await api.get(`/api/quizzes/${quizId}`);
    return response.data;
  },

  wakeUpServer,
};

export default teacherService;