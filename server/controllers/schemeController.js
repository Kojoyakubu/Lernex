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
  if (!validId(classId) || !String(term || '').trim() || !req.file) {
    res.status(400);
    throw new Error('Class, term, and a scheme file are required.');
  }
  if (!req.user.school) {
    res.status(400);
    throw new Error('Your account is not linked to a school.');
  }

  const classItem = await Class.findById(classId).select('name');
  const subjectItem = subjectId && validId(subjectId)
    ? await Subject.findById(subjectId).select('name class')
    : null;
  const selectedSubjectIsValid = !subjectId || (subjectItem && subjectItem.class.toString() === classItem?._id.toString());
  if (!classItem || !selectedSubjectIsValid) {
    res.status(400);
    throw new Error('The selected subject does not belong to the selected class.');
  }

  /*
   * A whole-class document must include a Subject column. Each subject is
   * matched to the existing class subject; no subject is invented from file text.
   */
  const parsedEntries = await parseSchemeFile(req.file);
  const groupedEntries = new Map();
  parsedEntries.forEach((entry) => {
    const key = subjectItem?._id.toString() || String(entry.subject || '').trim().toLowerCase();
    if (!groupedEntries.has(key)) groupedEntries.set(key, []);
    groupedEntries.get(key).push(entry);
  });
  if (!parsedEntries.length) {
    res.status(400);
    throw new Error('We could not identify any curriculum rows in this scheme.');
  }
  if (!subjectItem && parsedEntries.some((entry) => !entry.subject)) {
    res.status(400);
    throw new Error('For a whole-class document, add a Subject column to identify each scheme.');
  }

  const subjects = subjectItem ? [subjectItem] : await Subject.find({ class: classItem._id });
  const subjectByName = new Map(subjects.map((subject) => [String(subject.name).trim().toLowerCase(), subject]));
  const resolvedGroups = [];
  for (const [subjectKey, entries] of groupedEntries) {
    const resolvedSubject = subjectItem || subjectByName.get(subjectKey);
    if (!resolvedSubject) {
      res.status(400);
      throw new Error(`The document contains subject "${entries[0].subject}" but it is not configured for ${classItem.name}.`);
    }
    resolvedGroups.push({ subject: resolvedSubject, entries });
  }

  const schemes = await Promise.all(resolvedGroups.map(({ subject, entries }) => Scheme.create({
    teacher: req.user.id,
    school: req.user.school,
    class: classItem._id,
    subject: subject._id,
    term: normalizeTerm(term),
    originalFileName: req.file.originalname,
    fileType: req.file.mimetype || 'unknown',
    entries,
    importStatus: 'pending_review',
  })));

  if (schemes.length === 1) {
    return res.status(201).json({
      scheme: schemes[0],
      schemes,
      reviewRequired: schemes[0].entries.filter((entry) => entry.needsReview).length,
      message: 'Scheme analysed. Review the extracted rows before confirming the import.',
    });
  }

  return res.status(201).json({
    schemes,
    reviewRequired: schemes.reduce((total, scheme) => total + scheme.entries.filter((entry) => entry.needsReview).length, 0),
    message: `${schemes.length} subject schemes were detected. Review and confirm each one before generating lessons.`,
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