const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/userModel');
const { generateFromRequest } = require('../services/lessonAgentService');

const generateAgentLessons = asyncHandler(async (req, res) => {
  const { request, classId, subjectId, term, weeks, regenerate, teacherId } = req.body;
  if (!String(request || '').trim() && (!Array.isArray(weeks) || !weeks.length)) {
    res.status(400);
    throw new Error('Describe the lesson or provide the weeks to generate.');
  }
  let targetTeacherId = req.user.id;
  if (teacherId) {
    if (!['admin', 'school_admin'].includes(req.user.role) || !mongoose.Types.ObjectId.isValid(teacherId)) {
      res.status(403);
      throw new Error('You are not authorized to generate lessons for this teacher.');
    }
    const targetTeacher = await User.findById(teacherId).select('role school');
    if (!targetTeacher || targetTeacher.role !== 'teacher') {
      res.status(404);
      throw new Error('Target teacher not found.');
    }
    if (req.user.role === 'school_admin' && String(targetTeacher.school) !== String(req.user.school)) {
      res.status(403);
      throw new Error('You can only generate lessons for teachers in your school.');
    }
    targetTeacherId = teacherId;
  }
  const result = await generateFromRequest({
    teacherId: targetTeacherId,
    requestText: String(request || '').trim(),
    classId,
    subjectId,
    term,
    weeks,
    regenerate,
  });
  res.status(201).json(result);
});

module.exports = { generateAgentLessons };