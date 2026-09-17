const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { generateAgentLessons } = require('../controllers/lessonAgentController');

const router = express.Router();
router.post('/generate', protect, authorize('teacher', 'admin', 'school_admin'), generateAgentLessons);

module.exports = router;