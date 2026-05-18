// /server/controllers/curriculumController.js

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Level = require('../models/levelModel');
const Class = require('../models/classModel');
const Subject = require('../models/subjectModel');
const Strand = require('../models/strandModel');
const SubStrand = require('../models/subStrandModel');
const aiService = require('../services/aiService');

/* ============================================================================
 * CREATE OPERATIONS
 * ============================================================================
 */

// Create Level
const createLevel = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Level name is required.');
  }

  const existing = await Level.findOne({ name });
  if (existing) {
    res.status(400);
    throw new Error('This level already exists.');
  }

  const newLevel = await Level.create({ name });
  res.status(201).json(newLevel);
});

// Create Class
const createClass = asyncHandler(async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Class name is required.');
  }

  const classData = { name };
  if (parentId && mongoose.Types.ObjectId.isValid(parentId)) {
    classData.level = parentId;
  }

  const newClass = await Class.create(classData);
  res.status(201).json(newClass);
});

// Create Subject
const createSubject = asyncHandler(async (req, res) => {
  const { name, parentId } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Subject name is required.');
  }

  const subjectData = { name };
  if (parentId && mongoose.Types.ObjectId.isValid(parentId)) {
    subjectData.class = parentId;
  }

  const subject = await Subject.create(subjectData);
  res.status(201).json(subject);
});

// Create Strand
const createStrand = asyncHandler(async (req, res) => {
  const { name, parentId, aiExpand } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Strand name is required.');
  }

  const strandData = { name };
  if (parentId && mongoose.Types.ObjectId.isValid(parentId)) {
    strandData.subject = parentId;
  }

  const strand = await Strand.create(strandData);

  // AI expansion
  let aiSuggestions = [];
  if (aiExpand && parentId) {
    try {
      const subject = await Subject.findById(parentId);
      const prompt = `
You are a Ghanaian curriculum design expert.
Suggest 4–6 logical Sub-Strands that belong under the Strand "${name}" for the subject "${subject?.name || 'General'}".
Follow the NaCCA Ghana curriculum style.
Each Sub-Strand name should be short (max 8 words) and conceptually accurate.
Return ONLY a JSON array of sub-strand names. Example:
["Introduction to Plants", "Parts of a Plant", "Functions of Plant Parts"]
`;

      const { text } = await aiService.generateTextCore({
        prompt,
        task: 'curriculumExpansion',
        jsonNeeded: true,
      });

      aiSuggestions = JSON.parse(text);
      if (Array.isArray(aiSuggestions)) {
        for (const title of aiSuggestions) {
          await SubStrand.create({ strand: strand._id, name: title });
        }
      }
    } catch (err) {
      console.error('AI sub-strand generation failed:', err.message);
    }
  }

  res.status(201).json({
    message: 'Strand created successfully.',
    strand,
    aiGeneratedSubStrands: aiSuggestions,
  });
});

// Create Sub-Strand
const createSubStrand = asyncHandler(async (req, res) => {
  const { name, parentId } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Sub-strand name is required.');
  }

  const subStrandData = { name };
  if (parentId && mongoose.Types.ObjectId.isValid(parentId)) {
    subStrandData.strand = parentId;
  }

  const subStrand = await SubStrand.create(subStrandData);
  res.status(201).json(subStrand);
});

/* ============================================================================
 * READ OPERATIONS
 * ============================================================================
 */

// Get all items of a type
const getCurriculum = asyncHandler(async (req, res) => {
  const { type } = req.params;

  const models = {
    levels: Level,
    classes: Class,
    subjects: Subject,
    strands: Strand,
    'sub-strands': SubStrand,
    subStrands: SubStrand,
  };

  const model = models[type];
  if (!model) {
    res.status(400);
    throw new Error('Invalid type. Use levels, classes, subjects, strands, or sub-strands.');
  }

  let data = await model.find().sort({ createdAt: 1 }).lean();
  
  // Populate parent references
  if (type === 'classes') {
    data = await Class.find().populate('level', 'name').sort({ createdAt: 1 }).lean();
  } else if (type === 'subjects') {
    data = await Subject.find().populate('class', 'name').sort({ createdAt: 1 }).lean();
  } else if (type === 'strands') {
    data = await Strand.find().populate('subject', 'name').sort({ createdAt: 1 }).lean();
  } else if (type === 'sub-strands' || type === 'subStrands') {
    data = await SubStrand.find().populate('strand', 'name').sort({ createdAt: 1 }).lean();
  }

  res.json(data);
});

// Get children of a specific parent
const getChildren = asyncHandler(async (req, res) => {
  const { parentType, parentId, childType } = req.params;

  if (!mongoose.Types.ObjectId.isValid(parentId)) {
    res.status(400);
    throw new Error('Invalid parent ID.');
  }

  const filterMap = {
    'levels-classes': { model: Class, filter: { level: parentId }, populate: 'level' },
    'classes-subjects': { model: Subject, filter: { class: parentId }, populate: 'class' },
    'subjects-strands': { model: Strand, filter: { subject: parentId }, populate: 'subject' },
    'strands-sub-strands': { model: SubStrand, filter: { strand: parentId }, populate: 'strand' },
    'strands-subStrands': { model: SubStrand, filter: { strand: parentId }, populate: 'strand' },
  };

  const key = `${parentType}-${childType}`;
  const config = filterMap[key];

  if (!config) {
    res.status(400);
    throw new Error(`Invalid parent-child relationship: ${parentType} -> ${childType}`);
  }

  const data = await config.model
    .find(config.filter)
    .populate(config.populate, 'name')
    .sort({ createdAt: 1 })
    .lean();

  res.json(data);
});

/* ============================================================================
 * UPDATE OPERATIONS
 * ============================================================================
 */

const updateCurriculum = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid ID.');
  }

  const models = {
    levels: Level,
    classes: Class,
    subjects: Subject,
    strands: Strand,
    'sub-strands': SubStrand,
    subStrands: SubStrand,
  };

  const model = models[type];
  if (!model) {
    res.status(400);
    throw new Error('Invalid type.');
  }

  const item = await model.findByIdAndUpdate(id, { name }, { new: true });

  if (!item) {
    res.status(404);
    throw new Error(`${type} not found.`);
  }

  res.json(item);
});

/* ============================================================================
 * DELETE OPERATIONS
 * ============================================================================
 */

const deleteCurriculum = asyncHandler(async (req, res) => {
  const { type, id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid ID.');
  }

  const models = {
    levels: Level,
    classes: Class,
    subjects: Subject,
    strands: Strand,
    'sub-strands': SubStrand,
    subStrands: SubStrand,
  };

  const model = models[type];
  if (!model) {
    res.status(400);
    throw new Error('Invalid type.');
  }

  const item = await model.findById(id);
  if (!item) {
    res.status(404);
    throw new Error(`${type} not found.`);
  }

  // Cascade delete children
  if (type === 'levels') {
    await Class.deleteMany({ level: id });
  } else if (type === 'classes') {
    await Subject.deleteMany({ class: id });
  } else if (type === 'subjects') {
    await Strand.deleteMany({ subject: id });
  } else if (type === 'strands') {
    await SubStrand.deleteMany({ strand: id });
  }

  await item.deleteOne();
  res.json({ message: `${type} deleted successfully.`, id });
});

/* ============================================================================
 * AI AUTO-FILL
 * ============================================================================
 */

const autoFillSubStrand = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('Invalid sub-strand ID.');
  }

  const subStrand = await SubStrand.findById(id).populate({
    path: 'strand',
    populate: { path: 'subject', populate: 'class' },
  });

  if (!subStrand) {
    res.status(404);
    throw new Error('Sub-Strand not found.');
  }

  const prompt = `
You are a Ghanaian curriculum expert for the National Council for Curriculum and Assessment (NaCCA).
Provide a JSON object describing this sub-strand:
- Subject: ${subStrand.strand?.subject?.name || 'General'}
- Strand: ${subStrand.strand?.name || 'N/A'}
- Sub-Strand: ${subStrand.name}
- Class: ${subStrand.strand?.subject?.class?.name || 'N/A'}

JSON format:
{
  "description": "A concise academic description of this Sub-Strand.",
  "learningOutcomes": ["Outcome 1", "Outcome 2", "Outcome 3"],
  "keyCompetencies": ["Critical Thinking", "Collaboration"]
}
`;

  try {
    const { text } = await aiService.generateTextCore({
      prompt,
      task: 'curriculumDetails',
      jsonNeeded: true,
    });

    const parsed = JSON.parse(text);

    subStrand.description = parsed.description || '';
    subStrand.learningOutcomes = parsed.learningOutcomes || [];
    subStrand.keyCompetencies = parsed.keyCompetencies || [];
    await subStrand.save();

    res.json({
      message: 'Sub-Strand enriched successfully.',
      subStrand,
      aiGenerated: parsed,
    });
  } catch (err) {
    console.error('AI autofill failed:', err.message);
    res.status(500).json({
      message: 'AI enrichment failed. Please try again later.',
    });
  }
});

/* ============================================================================
 * COPY SUBJECT CURRICULUM
 * ============================================================================
 */

// POST /api/curriculum/copy-subject
// Body: { sourceSubjectId, targetClassIds: [id, id, ...] }
const copySubjectCurriculum = asyncHandler(async (req, res) => {
  const { sourceSubjectId, targetClassIds } = req.body;

  if (!mongoose.Types.ObjectId.isValid(sourceSubjectId)) {
    res.status(400);
    throw new Error('Invalid source subject ID.');
  }

  if (!Array.isArray(targetClassIds) || targetClassIds.length === 0) {
    res.status(400);
    throw new Error('At least one target class ID is required.');
  }

  const validTargetClassIds = targetClassIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validTargetClassIds.length === 0) {
    res.status(400);
    throw new Error('No valid target class IDs provided.');
  }

  const sourceSubject = await Subject.findById(sourceSubjectId).lean();
  if (!sourceSubject) {
    res.status(404);
    throw new Error('Source subject not found.');
  }

  // Load all strands and sub-strands for the source subject
  const sourceStrands = await Strand.find({ subject: sourceSubjectId }).lean();
  const strandIds = sourceStrands.map((s) => s._id);
  const sourceSubStrands = await SubStrand.find({ strand: { $in: strandIds } }).lean();

  const results = [];

  for (const targetClassId of validTargetClassIds) {
    // Find or create a subject with the same name in the target class
    let targetSubject = await Subject.findOne({ name: sourceSubject.name, class: targetClassId });
    if (!targetSubject) {
      targetSubject = await Subject.create({ name: sourceSubject.name, class: targetClassId });
    }

    // Remove any existing strands/sub-strands in target to avoid duplicates
    const existingStrands = await Strand.find({ subject: targetSubject._id }).lean();
    if (existingStrands.length > 0) {
      const existingStrandIds = existingStrands.map((s) => s._id);
      await SubStrand.deleteMany({ strand: { $in: existingStrandIds } });
      await Strand.deleteMany({ subject: targetSubject._id });
    }

    // Copy strands and their sub-strands
    for (const strand of sourceStrands) {
      const newStrand = await Strand.create({ name: strand.name, subject: targetSubject._id });

      const subStrandsForStrand = sourceSubStrands.filter(
        (ss) => String(ss.strand) === String(strand._id)
      );

      for (const ss of subStrandsForStrand) {
        await SubStrand.create({
          name: ss.name,
          strand: newStrand._id,
          description: ss.description || '',
          learningOutcomes: ss.learningOutcomes || [],
          keyCompetencies: ss.keyCompetencies || [],
        });
      }
    }

    results.push({
      classId: targetClassId,
      subjectId: targetSubject._id,
      subjectName: targetSubject.name,
      strandsCopied: sourceStrands.length,
      subStrandsCopied: sourceSubStrands.length,
    });
  }

  res.json({ message: 'Curriculum copied successfully.', results });
});

module.exports = {
  // Create
  createLevel,
  createClass,
  createSubject,
  createStrand,
  createSubStrand,

  // Read
  getCurriculum,
  getChildren,

  // Update
  updateCurriculum,

  // Delete
  deleteCurriculum,

  // Copy
  copySubjectCurriculum,

  // AI
  autoFillSubStrand,
};