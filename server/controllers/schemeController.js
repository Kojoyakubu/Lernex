const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Scheme = require('../models/schemeModel');
const Class = require('../models/classModel');
const Subject = require('../models/subjectModel');
const { parseSchemeFile } = require('../services/schemeParser');

const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const ownsScheme = (scheme, req) => scheme.teacher.toString() === req.user.id.toString();
const normalizeTerm = (term) => ({ one: 'First Term', two: 'Second Term', three: 'Third Term' }[String(term || '').trim().toLowerCase()] || String(term || '').trim());

const uploadScheme = asyncHandler(async (req, res) => {
  const { classId, subjectId, term } = req.body;
  if (!validId(classId) || !validId(subjectId) || !String(term || '').trim() || !req.file) {
    res.status(400);
    throw new Error('Class, subject, term, and a scheme file are required.');
  }
  if (!req.user.school) {
    res.status(400);
    throw new Error('Your account is not linked to a school.');
  }

  const [classItem, subjectItem] = await Promise.all([
    Class.findById(classId).select('name'),
    Subject.findById(subjectId).select('name class'),
  ]);
  if (!classItem || !subjectItem || subjectItem.class.toString() !== classItem._id.toString()) {
    res.status(400);
    throw new Error('The selected subject does not belong to the selected class.');
  }

  const entries = await parseSchemeFile(req.file);
  if (!entries.length) {
    res.status(400);
    throw new Error('We could not identify any curriculum rows in this scheme.');
  }

  const scheme = await Scheme.create({
    teacher: req.user.id,
    school: req.user.school,
    class: classItem._id,
    subject: subjectItem._id,
    term: normalizeTerm(term),
    originalFileName: req.file.originalname,
    fileType: req.file.mimetype || 'unknown',
    entries,
    importStatus: 'pending_review',
  });

  res.status(201).json({
    scheme,
    reviewRequired: entries.filter((entry) => entry.needsReview).length,
    message: 'Scheme analysed. Review the extracted rows before confirming the import.',
  });
});

const getMySchemes = asyncHandler(async (req, res) => {
  const schemes = await Scheme.find({ teacher: req.user.id, importStatus: { $ne: 'archived' } })
    .populate('class', 'name')
    .populate('subject', 'name')
    .sort({ createdAt: -1 });
  res.json(schemes);
});

const getSchemeById = asyncHandler(async (req, res) => {
  const scheme = await Scheme.findById(req.params.id).populate('class', 'name').populate('subject', 'name');
  if (!scheme) {
    res.status(404);
    throw new Error('Scheme not found.');
  }
  if (!ownsScheme(scheme, req) && !['admin', 'school_admin'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Not authorized to view this scheme.');
  }
  res.json(scheme);
});

const updateScheme = asyncHandler(async (req, res) => {
  const scheme = await Scheme.findById(req.params.id);
  if (!scheme) {
    res.status(404);
    throw new Error('Scheme not found.');
  }
  if (!ownsScheme(scheme, req)) {
    res.status(403);
    throw new Error('Not authorized to update this scheme.');
  }

  if (Array.isArray(req.body.entries)) scheme.entries = req.body.entries;
  if (req.body.importStatus === 'confirmed') scheme.importStatus = 'confirmed';
  await scheme.save();
  res.json(scheme);
});

const getSchemeWeeks = asyncHandler(async (req, res) => {
  const scheme = await Scheme.findById(req.params.id).lean();
  if (!scheme) {
    res.status(404);
    throw new Error('Scheme not found.');
  }
  if (scheme.teacher.toString() !== req.user.id.toString()) {
    res.status(403);
    throw new Error('Not authorized to view this scheme.');
  }

  const weeks = scheme.entries.flatMap((entry) => entry.weeks.map((week) => ({ week, entry })));
  res.json(weeks.sort((left, right) => left.week - right.week));
});

const getCurrentCurriculum = asyncHandler(async (req, res) => {
  const { classId, subjectId, term, week } = req.query;
  if (!validId(classId) || !validId(subjectId) || !String(term || '').trim() || !Number.isInteger(Number(week))) {
    res.status(400);
    throw new Error('Class, subject, term, and week are required.');
  }
  const scheme = await Scheme.findOne({
    teacher: req.user.id,
    class: classId,
    subject: subjectId,
    term: normalizeTerm(term),
    importStatus: 'confirmed',
  }).sort({ updatedAt: -1 }).lean();
  const entry = scheme?.entries?.find((item) => item.weeks.includes(Number(week)));
  res.json(entry || null);
});

const archiveScheme = asyncHandler(async (req, res) => {
  const scheme = await Scheme.findById(req.params.id);
  if (!scheme) {
    res.status(404);
    throw new Error('Scheme not found.');
  }
  if (!ownsScheme(scheme, req)) {
    res.status(403);
    throw new Error('Not authorized to archive this scheme.');
  }
  scheme.importStatus = 'archived';
  await scheme.save();
  res.json({ id: scheme._id, message: 'Scheme archived.' });
});

module.exports = {
  uploadScheme,
  getMySchemes,
  getSchemeById,
  updateScheme,
  getSchemeWeeks,
  getCurrentCurriculum,
  archiveScheme,
};