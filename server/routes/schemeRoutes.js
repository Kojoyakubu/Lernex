const express = require('express');
const multer = require('multer');
const path = require('path');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  uploadScheme,
  getMySchemes,
  getSchemeById,
  updateScheme,
  getSchemeWeeks,
  getCurrentCurriculum,
  archiveScheme,
} = require('../controllers/schemeController');

const router = express.Router();
const allowedExtensions = new Set(['.docx', '.xlsx', '.xls', '.pdf', '.csv']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (allowedExtensions.has(path.extname(file.originalname).toLowerCase())) return callback(null, true);
    return callback(new Error('File type not allowed. Upload DOCX, XLSX, XLS, PDF, or CSV.'));
  },
});

router.post('/upload', protect, authorize('teacher'), upload.single('schemeFile'), uploadScheme);
router.get('/', protect, authorize('teacher'), getMySchemes);
router.get('/current', protect, authorize('teacher'), getCurrentCurriculum);
router.get('/:id/weeks', protect, authorize('teacher'), getSchemeWeeks);
router.get('/:id', protect, authorize('teacher', 'admin', 'school_admin'), getSchemeById);
router.put('/:id', protect, authorize('teacher'), updateScheme);
router.delete('/:id', protect, authorize('teacher'), archiveScheme);

module.exports = router;