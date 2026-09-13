// /server/routes/teacherRoutes.js
const express = require('express');
const router = express.Router();

const {
  generateLessonNote,
  getMyLessonNotes,
  getLessonNoteById,
  deleteLessonNote,
  deleteLessonNotes,
  generateLearnerNote,
  generateLearnerNoteFromStrand,
  getMySchoolCalendar,
  getDraftLearnerNotes,
  publishLearnerNote,
  deleteLearnerNote,
  createQuiz,
  uploadResource,
  getTeacherAnalytics,
  searchImage,
  generateLessonBundle, // ✅ NEW: Bundle orchestrator
  getMyBundles,
  getBundleById,
  updateBundle,
  deleteBundle,
  duplicateBundle,
} = require('../controllers/teacherController');

const { protect, authorize } = require('../middleware/authMiddleware');

// --- Lesson Notes ---
router.post('/ai/generate-note', protect, authorize('teacher'), generateLessonNote);
router.get('/lesson-notes', protect, authorize('teacher'), getMyLessonNotes);
router.delete('/lesson-notes', protect, authorize('teacher'), deleteLessonNotes);
router.get('/lesson-notes/:id', protect, authorize('teacher', 'admin', 'school_admin'), getLessonNoteById);
router.delete('/lesson-notes/:id', protect, authorize('teacher'), deleteLessonNote);

// --- Learner Notes ---
router.post('/ai/generate-learner-note', protect, authorize('teacher'), generateLearnerNote);
router.post('/ai/generate-learner-note-from-strand', protect, authorize('teacher'), generateLearnerNoteFromStrand);
router.get('/learner-notes/drafts', protect, authorize('teacher'), getDraftLearnerNotes);
router.put('/learner-notes/:id/publish', protect, authorize('teacher'), publishLearnerNote);
router.delete('/learner-notes/:id', protect, authorize('teacher'), deleteLearnerNote);

// --- AI Lesson Bundle (All-in-One Generation) ---
router.post('/ai/generate-lesson-bundle', protect, authorize('teacher'), generateLessonBundle);

// --- Lesson Bundles (CRUD) ---
router.get('/bundles', protect, authorize('teacher'), getMyBundles);
router.get('/bundles/:id', protect, authorize('teacher', 'admin', 'school_admin'), getBundleById);
router.put('/bundles/:id', protect, authorize('teacher'), updateBundle);
router.delete('/bundles/:id', protect, authorize('teacher'), deleteBundle);
router.post('/bundles/:id/duplicate', protect, authorize('teacher'), duplicateBundle);

// --- Quizzes ---
router.post('/quizzes', protect, authorize('teacher'), createQuiz);

// --- Resources ---
router.post('/resources/upload', protect, authorize('teacher'), uploadResource);

// --- Analytics (primary) ---
router.get('/analytics', protect, authorize('teacher'), getTeacherAnalytics);
router.get('/school-calendar', protect, authorize('teacher'), getMySchoolCalendar);

// ✅ Aliases (fixes /api/teacher/insights and /api/teacher/dashboard 404s)
router.get('/insights',  protect, authorize('teacher'), getTeacherAnalytics);
router.get('/dashboard', protect, authorize('teacher'), getTeacherAnalytics);

// --- Utility ---
router.get('/search-image', protect, authorize('teacher'), searchImage);

module.exports = router;