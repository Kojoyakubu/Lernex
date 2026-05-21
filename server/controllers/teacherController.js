// /server/controllers/teacherController.js

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const axios = require('axios');

const LessonNote = require('../models/lessonNoteModel');
const LearnerNote = require('../models/learnerNoteModel');
const Quiz = require('../models/quizModel');
const Question = require('../models/questionModel');
const Option = require('../models/optionModel');
const Resource = require('../models/resourceModel');
const NoteView = require('../models/noteViewModel');
const QuizAttempt = require('../models/quizAttemptModel');
const SubStrand = require('../models/subStrandModel');
const LessonBundle = require('../models/lessonBundleModel');
const School = require('../models/schoolModel');

const aiService = require('../services/aiService');

/**
 * @desc    Generate a lesson note with AI
 * @route   POST /api/teacher/generate-note
 * @access  Private (Teacher)
 */
const generateLessonNote = asyncHandler(async (req, res) => {
  const { subStrandId, subStrandIds, ...noteDetails } = req.body;

  const requestedSubStrandIds = Array.from(new Set([
    ...(Array.isArray(subStrandIds) ? subStrandIds : []),
    ...(subStrandId ? [subStrandId] : []),
  ].map((id) => String(id || '').trim()).filter(Boolean)));

  if (requestedSubStrandIds.length === 0 || requestedSubStrandIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    res.status(400);
    throw new Error('At least one valid Sub-strand ID is required.');
  }

  const subStrands = await SubStrand.find({ _id: { $in: requestedSubStrandIds } }).populate({
    path: 'strand',
    populate: {
      path: 'subject',
      populate: { path: 'class' },
    },
  });

  if (!subStrands.length) {
    res.status(404);
    throw new Error('Sub-strand(s) not found');
  }

  if (subStrands.length !== requestedSubStrandIds.length) {
    res.status(404);
    throw new Error('One or more selected sub-strands were not found.');
  }

  const orderedSubStrands = requestedSubStrandIds
    .map((id) => subStrands.find((item) => String(item._id) === String(id)))
    .filter(Boolean);

  const primarySubStrand = orderedSubStrands[0];

  const selectedTopicContext = orderedSubStrands.map((item, index) => ({
    position: index + 1,
    subStrandName: item?.name || 'N/A',
    strandName: item?.strand?.name || 'N/A',
    subjectName: item?.strand?.subject?.name || 'N/A',
    className: item?.strand?.subject?.class?.name || 'N/A',
  }));

  const mixedSubjects = new Set(selectedTopicContext.map((entry) => entry.subjectName).filter(Boolean));
  const mixedClasses = new Set(selectedTopicContext.map((entry) => entry.className).filter(Boolean));

  if (mixedSubjects.size > 1 || mixedClasses.size > 1) {
    res.status(400);
    throw new Error('Selected sub-strands must belong to the same class and subject to generate a single lesson note.');
  }

  const mergedSubStrandName = selectedTopicContext.map((entry) => entry.subStrandName).join(', ');
  const mergedStrandName = Array.from(new Set(selectedTopicContext.map((entry) => entry.strandName).filter(Boolean))).join(', ');
  const mergedSubjectName = selectedTopicContext[0]?.subjectName || primarySubStrand?.strand?.subject?.name || 'N/A';
  const mergedClassName = noteDetails.class || selectedTopicContext[0]?.className || primarySubStrand?.strand?.subject?.class?.name || 'N/A';
  const multiTopicContext = selectedTopicContext
    .map((entry) => `${entry.position}. Strand: ${entry.strandName} | Sub-strand: ${entry.subStrandName}`)
    .join('\n');

  const aiDetails = {
    ...noteDetails,
    school: noteDetails.school || '',
    facilitatorName: noteDetails.facilitatorName || '',
    term: noteDetails.term || '',
    week: noteDetails.week || '',
    weekEnding: noteDetails.weekEnding || '',
    dayDate: noteDetails.dayDate || '',
    duration: noteDetails.duration || '',
    classSize: noteDetails.classSize || '',
    contentStandardCode: noteDetails.contentStandardCode || '',
    indicatorCodes: noteDetails.indicatorCodes || '',
    reference: noteDetails.reference || '',
    sessionsPerWeek: noteDetails.sessionsPerWeek || 1,
    sessionPlan: noteDetails.sessionPlan || '',
    subStrandName: mergedSubStrandName || 'N/A',
    strandName: mergedStrandName || 'N/A',
    subjectName: mergedSubjectName || 'N/A',
    className: mergedClassName || 'N/A',
    topicCount: selectedTopicContext.length,
    multiTopicContext,
  };

  // Use the same HTML generator used by the bundle pipeline so single-note
  // generation matches the richer layout/structure of bundle teacher notes.
  const {
    text: teacherNoteHTML,
    provider: aiProvider,
    model: aiModel,
    timestamp,
  } = await aiService.generateTeacherLessonNoteHTML(aiDetails);

  const lessonNote = await LessonNote.create({
    teacher: req.user.id,
    school: req.user.school,
    subStrand: primarySubStrand._id,
    content: teacherNoteHTML,
    generationContext: {
      facilitatorName: aiDetails.facilitatorName,
      term: aiDetails.term,
      week: aiDetails.week,
      weekEnding: aiDetails.weekEnding || '',
      dayDate: aiDetails.dayDate,
      duration: aiDetails.duration,
      classSize: aiDetails.classSize || null,
      contentStandardCode: aiDetails.contentStandardCode,
      indicatorCodes: aiDetails.indicatorCodes,
      reference: aiDetails.reference,
      sessionsPerWeek: aiDetails.sessionsPerWeek || 1,
      sessionPlan: aiDetails.sessionPlan || '',
    },
    aiProvider,
    aiModel,
    aiGeneratedAt: new Date(timestamp),
  });

  res.status(201).json(lessonNote);
});

/**
 * @desc    Get all lesson notes for the logged-in teacher
 * @route   GET /api/teacher/lesson-notes
 * @access  Private (Teacher)
 */
const getMyLessonNotes = asyncHandler(async (req, res) => {
  const { groupBy, facilitator } = req.query;

  // If client requests grouping by facilitator, return grouped summary
  if (String(groupBy || '').toLowerCase() === 'facilitator') {
    const teacherId = mongoose.Types.ObjectId(req.user.id);

    const groups = await LessonNote.aggregate([
      { $match: { teacher: teacherId } },
      {
        $group: {
          _id: { $ifNull: ['$generationContext.facilitatorName', ''] },
          notes: {
            $push: {
              _id: '$_id',
              subStrand: '$subStrand',
              createdAt: '$createdAt',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, facilitatorName: '$_id', notes: 1, count: 1 } },
      { $sort: { facilitatorName: 1 } },
    ]);

    return res.json(groups);
  }

  // If filtering by facilitator, return populated notes for that facilitator
  const query = { teacher: req.user.id };
  if (facilitator !== undefined && facilitator !== null && String(facilitator).trim() !== '') {
    query['generationContext.facilitatorName'] = String(facilitator).trim();
  }

  const notes = await LessonNote.find(query)
    .populate({
      path: 'subStrand',
      select: 'name',
      populate: {
        path: 'strand',
        select: 'name',
        populate: {
          path: 'subject',
          select: 'name',
          populate: { path: 'class', select: 'name' },
        },
      },
    })
    .sort({ createdAt: -1 });

  res.json(notes);
});

/**
 * @desc    Get a single lesson note by ID
 * @route   GET /api/teacher/lesson-notes/:id
 * @access  Private (Teacher)
 */
const getLessonNoteById = asyncHandler(async (req, res) => {
  const note = await LessonNote.findById(req.params.id);

  if (!note) {
    res.status(404);
    throw new Error('Lesson note not found');
  }

  if (note.teacher.toString() !== req.user.id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to view this note');
  }

  res.json(note);
});

/**
 * @desc    Delete a lesson note
 * @route   DELETE /api/teacher/lesson-notes/:id
 * @access  Private (Teacher)
 */
const deleteLessonNote = asyncHandler(async (req, res) => {
  const note = await LessonNote.findById(req.params.id);

  if (!note) {
    res.status(404);
    throw new Error('Lesson note not found');
  }

  if (note.teacher.toString() !== req.user.id.toString()) {
    res.status(403);
    throw new Error('Not authorized to delete this note');
  }

  await note.deleteOne();
  res.status(200).json({ id: req.params.id, message: 'Lesson note deleted' });
});

/**
 * @desc    Generate a learner's version of a lesson note
 * @route   POST /api/teacher/generate-learner-note
 * @access  Private (Teacher)
 */
const generateLearnerNote = asyncHandler(async (req, res) => {
  const { lessonNoteId, preferredProvider, preferredModel } = req.body;
  const lessonNote = await LessonNote.findById(lessonNoteId).populate({
    path: 'subStrand',
    populate: {
      path: 'strand',
      populate: { path: 'subject', populate: { path: 'class' } },
    },
  });

  if (!lessonNote || lessonNote.teacher.toString() !== req.user.id.toString()) {
    res.status(404);
    throw new Error('Lesson note not found or you are not the author.');
  }

  // Use HTML transformer so learner note is returned as HTML (matches bundle flow)
  const { text: learnerNoteHTML, provider, model, timestamp } = await aiService.generateLearnerNoteHTML(
    lessonNote.content,
    {
      subStrandName: lessonNote.subStrand?.name || 'Topic',
      className: lessonNote.subStrand?.strand?.subject?.class?.name || 'Class',
      preferredProvider,
      preferredModel,
    }
  );

  const learnerNote = await LearnerNote.create({
    author: req.user.id,
    school: req.user.school,
    subStrand: lessonNote.subStrand?._id || lessonNote.subStrand,
    content: learnerNoteHTML,
    aiProvider: provider,
    aiModel: model,
    aiGeneratedAt: new Date(timestamp),
    status: 'draft',
  });

  // populate subStrand name for client convenience
  await learnerNote.populate({ path: 'subStrand', select: 'name' });

  res.status(201).json(learnerNote);
});

/**
 * @desc    Generate learner note from curriculum strand selection
 * @route   POST /api/teacher/ai/generate-learner-note-from-strand
 * @access  Private (Teacher)
 */
const generateLearnerNoteFromStrand = asyncHandler(async (req, res) => {
  const {
    subStrandId,
    school,
    facilitatorName,
    term,
    week,
    weekEnding,
    dayDate,
    duration,
    classSize,
    contentStandardCode,
    indicatorCodes,
    reference,
    sessionsPerWeek,
    sessionPlan,
    preferredProvider,
    preferredModel,
  } = req.body;

  if (!subStrandId || !mongoose.Types.ObjectId.isValid(subStrandId)) {
    res.status(400);
    throw new Error('Valid subStrandId is required');
  }

  const subStrand = await SubStrand.findById(subStrandId).populate({
    path: 'strand',
    populate: {
      path: 'subject',
      populate: { path: 'class' },
    },
  });

  if (!subStrand) {
    res.status(404);
    throw new Error('Sub-strand not found');
  }

  const curriculumDetails = {
    school: school || '',
    facilitatorName: facilitatorName || '',
    term: term || '',
    week: week || '',
    weekEnding: weekEnding || '',
    dayDate: dayDate || '',
    duration: duration || '',
    classSize: classSize || '',
    contentStandardCode: contentStandardCode || '',
    indicatorCodes: indicatorCodes || '',
    reference: reference || '',
    sessionsPerWeek: sessionsPerWeek || 1,
    sessionPlan: sessionPlan || '',
    subStrandName: subStrand.name,
    strandName: subStrand.strand?.name || 'N/A',
    subjectName: subStrand.strand?.subject?.name || 'N/A',
    className: subStrand.strand?.subject?.class?.name || 'N/A',
  };

  // first generate teacher note HTML so learner generator has structured input
  const {
    text: teacherNoteHTML,
  } = await aiService.generateTeacherLessonNoteHTML(curriculumDetails);

  const {
    text: learnerNoteHTML,
    provider,
    model,
    timestamp,
  } = await aiService.generateLearnerNoteHTML(teacherNoteHTML, curriculumDetails);

  const learnerNote = await LearnerNote.create({
    author: req.user.id,
    school: req.user.school,
    subStrand: subStrandId,
    content: learnerNoteHTML,
    aiProvider: provider,
    aiModel: model,
    aiGeneratedAt: new Date(timestamp),
    status: 'draft',
  });
  await learnerNote.populate({ path: 'subStrand', select: 'name' });

  res.status(201).json(learnerNote);
});

/**
 * @desc    Create a new quiz (manual create)
 * @route   POST /api/teacher/create-quiz
 * @access  Private (Teacher)
 */
const createQuiz = asyncHandler(async (req, res) => {
  const { title, subjectId } = req.body;
  const quiz = await Quiz.create({
    title,
    subject: subjectId,
    teacher: req.user.id,
    school: req.user.school,
  });
  res.status(201).json({ message: `Quiz '${title}' created successfully.`, quiz });
});

/**
 * @desc    Upload a resource file
 * @route   POST /api/teacher/upload-resource
 * @access  Private (Teacher)
 */
const uploadResource = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No file uploaded. Please include a file in your request.');
  }
  const { subStrandId } = req.body;
  const resource = await Resource.create({
    teacher: req.user.id,
    school: req.user.school,
    subStrand: subStrandId,
    fileName: req.file.originalname,
    filePath: req.file.path,
    fileType: req.file.mimetype,
  });
  res.status(201).json(resource);
});

/**
 * @desc    Get teacher analytics dashboard
 * @route   GET /api/teacher/analytics
 * @access  Private (Teacher)
 */
const getTeacherAnalytics = asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const quizzes = await Quiz.find({ teacher: teacherId }).select('_id');
  const quizIds = quizzes.map((q) => q._id);

  const [totalNoteViews, totalQuizAttempts, averageScoreResult] = await Promise.all([
    NoteView.countDocuments({ teacher: teacherId }),
    QuizAttempt.countDocuments({ quiz: { $in: quizIds } }),
    quizIds.length === 0
      ? null
      : QuizAttempt.aggregate([
          { $match: { quiz: { $in: quizIds } } },
          {
            $group: {
              _id: null,
              averagePercentage: {
                $avg: { $multiply: [{ $divide: ['$score', '$totalQuestions'] }, 100] },
              },
            },
          },
        ]),
  ]);

  const averageScore =
    averageScoreResult && averageScoreResult[0] ? averageScoreResult[0].averagePercentage : 0;

  res.json({
    totalNoteViews,
    totalQuizAttempts,
    averageScore: Number(averageScore.toFixed(2)),
  });
});

/**
 * @desc    Get all draft learner notes for the logged-in teacher
 * @route   GET /api/teacher/learner-notes/drafts
 * @access  Private (Teacher)
 */
const getDraftLearnerNotes = asyncHandler(async (req, res) => {
  const draftNotes = await LearnerNote.find({ author: req.user.id, status: 'draft' })
    .populate('subStrand', 'name')
    .sort({ createdAt: -1 });
  res.json(draftNotes);
});

/**
 * @desc    Get current teacher school term calendar
 * @route   GET /api/teacher/school-calendar
 * @access  Private (Teacher)
 */
const getMySchoolCalendar = asyncHandler(async (req, res) => {
  if (!req.user.school) {
    res.status(404);
    throw new Error('Teacher is not assigned to a school');
  }

  const school = await School.findById(req.user.school).select('name termCalendar');
  if (!school) {
    res.status(404);
    throw new Error('School not found');
  }

  res.json({
    schoolId: school._id,
    schoolName: school.name,
    termCalendar: school.termCalendar || { one: [], two: [], three: [] },
  });
});

/**
 * @desc    Publish a draft learner note
 * @route   PUT /api/teacher/learner-notes/:id/publish
 * @access  Private (Teacher)
 */
const publishLearnerNote = asyncHandler(async (req, res) => {
  const note = await LearnerNote.findOne({ _id: req.params.id, author: req.user.id });
  if (!note) {
    res.status(404);
    throw new Error('Draft note not found.');
  }
  note.status = 'published';
  await note.save();
  res.json({ message: 'Note published successfully!', id: note._id });
});

/**
 * @desc    Delete a learner note
 * @route   DELETE /api/teacher/learner-notes/:id
 * @access  Private (Teacher)
 */
const deleteLearnerNote = asyncHandler(async (req, res) => {
  const note = await LearnerNote.findOne({ _id: req.params.id, author: req.user.id });
  if (!note) {
    res.status(404);
    throw new Error('Note not found.');
  }
  await note.deleteOne();
  res.json({ message: 'Note deleted successfully!', id: req.params.id });
});

/**
 * @desc    Search for an image using Pexels API
 * @route   GET /api/teacher/search-image
 * @access  Private (Teacher)
 */
const searchImage = asyncHandler(async (req, res) => {
  const { query } = req.query;
  if (!query) {
    res.status(400);
    throw new Error('Query parameter is required.');
  }

  const response = await axios.get(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`,
    {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      timeout: 8000,
    }
  );

  const imageUrl = response.data?.photos?.[0]?.src?.medium || null;
  res.json({ imageUrl });
});

/**
 * @desc    Generate complete lesson bundle (Teacher Note + Learner Note + Quiz) with AI
 * @route   POST /api/teacher/ai/generate-lesson-bundle
 * @access  Private (Teacher)
 */
const generateLessonBundle = asyncHandler(async (req, res) => {
  const {
    subStrandId,
    school,
    facilitatorName,
    term,
    week,
    weekEnding,
    dayDate,
    duration,
    classSize,
    contentStandardCode,
    indicatorCodes,
    reference,
    sessionsPerWeek,
    sessionPlan,
    numQuestions = 20,
  } = req.body;

  // Validate subStrandId
  if (!subStrandId || !mongoose.Types.ObjectId.isValid(subStrandId)) {
    res.status(400);
    throw new Error('Valid subStrandId is required');
  }

  // Validate required fields
  if (!week || !classSize) {
    res.status(400);
    throw new Error('Week number and class size are required');
  }

  // Fetch full curriculum hierarchy
  const subStrand = await SubStrand.findById(subStrandId).populate({
    path: 'strand',
    populate: {
      path: 'subject',
      populate: { path: 'class' },
    },
  });

  if (!subStrand) {
    res.status(404);
    throw new Error('Sub-strand not found');
  }

  // Build curriculum details object
  const curriculumDetails = {
    school: school || '',
    facilitatorName: facilitatorName || '',
    term: term || '',
    week,
    weekEnding: weekEnding || '',
    dayDate: dayDate || '',
    duration: duration || '',
    classSize,
    contentStandardCode: contentStandardCode || '',
    indicatorCodes: indicatorCodes || '',
    reference: reference || '',
    sessionsPerWeek: sessionsPerWeek || 1,
    sessionPlan: sessionPlan || '',
    subStrandName: subStrand.name,
    strandName: subStrand.strand?.name || 'N/A',
    subjectName: subStrand.strand?.subject?.name || 'N/A',
    className: subStrand.strand?.subject?.class?.name || 'N/A',
  };

  console.log('🤖 Starting AI Lesson Bundle Generation...');
  console.log(`📚 Topic: ${curriculumDetails.subStrandName}`);
  console.log(`🏫 Class: ${curriculumDetails.className}`);
  console.log(`📖 Subject: ${curriculumDetails.subjectName}`);

  // PIPELINE STEP 1: Generate Teacher Note (HTML)
  console.log('🤖 [1/3] Generating Teacher Lesson Note (HTML)...');
  const {
    text: teacherNoteHTML,
    provider: p1,
    model: m1,
    timestamp: t1,
  } = await aiService.generateTeacherLessonNoteHTML(curriculumDetails);

  // PIPELINE STEP 2: Generate Learner Note (HTML)
  console.log('🤖 [2/3] Generating Learner Note (HTML)...');
  const {
    text: learnerNoteHTML,
    provider: p2,
    model: m2,
    timestamp: t2,
  } = await aiService.generateLearnerNoteHTML(teacherNoteHTML, curriculumDetails);

  // PIPELINE STEP 3: Generate Structured Quiz (JSON)
  console.log('🤖 [3/3] Generating Structured Quiz (4 types)...');
  const {
    quiz: structuredQuiz,
    provider: p3,
    model: m3,
    timestamp: t3,
  } = await aiService.generateStructuredQuizJSON({
    ...curriculumDetails,
    numQuestions,
  });

  console.log('💾 Saving to MongoDB...');

  // Save Lesson Note to DB
  const lessonNote = await LessonNote.create({
    teacher: req.user.id,
    school: req.user.school,
    subStrand: subStrandId,
    content: teacherNoteHTML,
    generationContext: {
      facilitatorName: curriculumDetails.facilitatorName,
      term: curriculumDetails.term,
      week,
      weekEnding: curriculumDetails.weekEnding || '',
      dayDate: curriculumDetails.dayDate,
      duration: curriculumDetails.duration,
      classSize,
      contentStandardCode: curriculumDetails.contentStandardCode,
      indicatorCodes: curriculumDetails.indicatorCodes,
      reference: curriculumDetails.reference,
      sessionsPerWeek: sessionsPerWeek || 1,
      sessionPlan: sessionPlan || '',
    },
    aiProvider: p1,
    aiModel: m1,
    aiGeneratedAt: new Date(t1),
  });

  // Save Learner Note to DB (as draft)
  const learnerNote = await LearnerNote.create({
    author: req.user.id,
    school: req.user.school,
    subStrand: subStrandId,
    content: learnerNoteHTML,
    status: 'draft',
    aiProvider: p2,
    aiModel: m2,
    aiGeneratedAt: new Date(t2),
  });

  // Create Quiz document
  const quizDoc = await Quiz.create({
    title: `${subStrand.name} - ${curriculumDetails.className}`,
    subject: subStrand.strand.subject._id,
    teacher: req.user.id,
    school: req.user.school,
    aiProvider: p3,
    aiModel: m3,
    aiGeneratedAt: new Date(t3),
  });

  // Save all quiz questions (MCQ, True/False, Short Answer, Essay)
  const savedQuestionIds = [];

  // ✅ FIXED: Save MCQ questions with quiz reference AND explanations
  for (const mcq of structuredQuiz.mcq || []) {
    const qDoc = await Question.create({
      text: mcq.question,
      explanation: mcq.explanation || '', // ✅ ADDED: Save explanation
      difficultyLevel: 'Medium',
      topicTags: [subStrand.name, 'MCQ'],
      quiz: quizDoc._id, // ✅ ADDED: Link to quiz
    });

    // Create 4 options for each MCQ
    for (let i = 0; i < mcq.options.length; i++) {
      await Option.create({
        question: qDoc._id,
        text: mcq.options[i],
        isCorrect: i === mcq.correctIndex,
      });
    }

    savedQuestionIds.push(qDoc._id);
  }

  // ✅ FIXED: Save True/False questions with quiz reference AND explanations
  for (const tf of structuredQuiz.trueFalse || []) {
    const qDoc = await Question.create({
      text: tf.statement,
      explanation: tf.explanation || '', // ✅ ADDED: Save explanation
      difficultyLevel: 'Easy',
      topicTags: [subStrand.name, 'True/False'],
      quiz: quizDoc._id, // ✅ ADDED: Link to quiz
    });

    await Option.create({
      question: qDoc._id,
      text: 'True',
      isCorrect: tf.answer === true,
    });

    await Option.create({
      question: qDoc._id,
      text: 'False',
      isCorrect: tf.answer === false,
    });

    savedQuestionIds.push(qDoc._id);
  }

  // ✅ FIXED: Save Short Answer questions with quiz reference
  for (const sa of structuredQuiz.shortAnswer || []) {
    const qDoc = await Question.create({
      text: sa.question,
      difficultyLevel: 'Medium',
      topicTags: [subStrand.name, 'Short Answer'],
      quiz: quizDoc._id, // ✅ ADDED: Link to quiz
    });

    savedQuestionIds.push(qDoc._id);
  }

  // ✅ FIXED: Save Essay questions with quiz reference
  for (const essay of structuredQuiz.essay || []) {
    const qDoc = await Question.create({
      text: essay.question,
      difficultyLevel: 'Hard',
      topicTags: [subStrand.name, 'Essay'],
      quiz: quizDoc._id, // ✅ ADDED: Link to quiz
    });

    savedQuestionIds.push(qDoc._id);
  }

  // ✅ ADDED: Link quiz to learner note
  learnerNote.quiz = quizDoc._id;
  await learnerNote.save();

  // ✅ NEW: Create the Lesson Bundle (saves references, makes it reusable)
  const lessonBundle = await LessonBundle.create({
    teacher: req.user.id,
    school: req.user.school,
    subStrand: subStrandId,
    title: `${subStrand.name} - ${curriculumDetails.className}`,
    description: `Generated for ${school}, Term ${term}, Week ${week}`,
    status: 'published', // Auto-publish bundles
    lessonNote: lessonNote._id,
    learnerNote: learnerNote._id,
    quiz: quizDoc._id,
    generationContext: curriculumDetails,
    aiProvider: p1, // Use first provider as representative
    aiModel: m1,
    aiGeneratedAt: new Date(t1),
    tags: [
      curriculumDetails.className,
      curriculumDetails.subjectName,
      curriculumDetails.strandName,
      subStrand.name,
    ].filter(Boolean),
  });

  console.log(`✅ Bundle Generation Complete!`);
  console.log(`   📦 Bundle ID: ${lessonBundle._id}`);
  console.log(`   📝 Teacher Note: ${lessonNote._id}`);
  console.log(`   📖 Learner Note: ${learnerNote._id}`);
  console.log(`   ❓ Quiz: ${quizDoc._id} (${savedQuestionIds.length} questions)`);

  // Return combined response
  res.status(201).json({
    success: true,
    message: 'Lesson bundle generated successfully!',
    bundle: {
      id: lessonBundle._id,
      title: lessonBundle.title,
      description: lessonBundle.description,
      status: lessonBundle.status,
      createdAt: lessonBundle.createdAt,
    },
    lessonNote: {
      id: lessonNote._id,
      content: lessonNote.content,
      subStrand: subStrand.name,
      createdAt: lessonNote.createdAt,
    },
    learnerNote: {
      id: learnerNote._id,
      content: learnerNote.content,
      status: learnerNote.status,
      createdAt: learnerNote.createdAt,
    },
    quiz: {
      id: quizDoc._id,
      title: quizDoc.title,
      totalQuestions: savedQuestionIds.length,
      breakdown: {
        mcq: (structuredQuiz.mcq || []).length,
        trueFalse: (structuredQuiz.trueFalse || []).length,
        shortAnswer: (structuredQuiz.shortAnswer || []).length,
        essay: (structuredQuiz.essay || []).length,
      },
      // Include the actual quiz data for frontend display
      mcq: structuredQuiz.mcq || [],
      trueFalse: structuredQuiz.trueFalse || [],
      shortAnswer: structuredQuiz.shortAnswer || [],
      essay: structuredQuiz.essay || [],
    },
  });
});

/**
 * @desc    Get all lesson bundles for the logged-in teacher
 * @route   GET /api/teacher/bundles
 * @access  Private (Teacher)
 */
const getMyBundles = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  
  // Build query
  const query = { teacher: req.user.id };
  
  // Filter by status if provided
  if (status && ['draft', 'published', 'archived'].includes(status)) {
    query.status = status;
  }
  
  // Search by title/description if provided
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $in: [new RegExp(search, 'i')] } },
    ];
  }
  
  const bundles = await LessonBundle.find(query)
    .populate('subStrand', 'name')
    .populate('lessonNote', 'content createdAt')
    .populate('learnerNote', 'content status createdAt')
    .populate('quiz', 'title')
    .sort({ createdAt: -1 });
    
  res.json(bundles);
});

/**
 * @desc    Get a single bundle by ID with full details
 * @route   GET /api/teacher/bundles/:id
 * @access  Private (Teacher)
 */
const getBundleById = asyncHandler(async (req, res) => {
  const bundle = await LessonBundle.findById(req.params.id)
    .populate('subStrand', 'name')
    .populate('lessonNote', 'content createdAt')
    .populate('learnerNote', 'content status createdAt')
    .populate({
      path: 'quiz',
      populate: {
        path: 'subject',
        select: 'name',
      },
    })
    .populate('resources', 'fileName filePath fileType');
    
  if (!bundle) {
    res.status(404);
    throw new Error('Bundle not found');
  }
  
  // Check authorization
  if (bundle.teacher.toString() !== req.user.id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to view this bundle');
  }
  
  // Fetch quiz questions for the bundle
  const questions = await Question.find({ quiz: bundle.quiz._id })
    .sort({ createdAt: 1 });
    
  // Group questions by type
  const quizData = {
    mcq: [],
    trueFalse: [],
    shortAnswer: [],
    essay: [],
  };
  
  for (const question of questions) {
    const options = await Option.find({ question: question._id });
    
    if (question.topicTags.includes('MCQ')) {
      quizData.mcq.push({
        question: question.text,
        explanation: question.explanation,
        options: options.map(o => o.text),
        correctIndex: options.findIndex(o => o.isCorrect),
      });
    } else if (question.topicTags.includes('True/False')) {
      const correctOption = options.find(o => o.isCorrect);
      quizData.trueFalse.push({
        statement: question.text,
        explanation: question.explanation,
        answer: correctOption ? correctOption.text === 'True' : false,
      });
    } else if (question.topicTags.includes('Short Answer')) {
      quizData.shortAnswer.push({
        question: question.text,
      });
    } else if (question.topicTags.includes('Essay')) {
      quizData.essay.push({
        question: question.text,
      });
    }
  }
  
  res.json({
    ...bundle.toObject(),
    quizData,
  });
});

/**
 * @desc    Update bundle metadata (title, description, status, tags)
 * @route   PUT /api/teacher/bundles/:id
 * @access  Private (Teacher)
 */
const updateBundle = asyncHandler(async (req, res) => {
  const bundle = await LessonBundle.findById(req.params.id);
  
  if (!bundle) {
    res.status(404);
    throw new Error('Bundle not found');
  }
  
  // Check authorization
  if (bundle.teacher.toString() !== req.user.id.toString()) {
    res.status(403);
    throw new Error('Not authorized to update this bundle');
  }
  
  // Update allowed fields
  const { title, description, status, tags } = req.body;
  
  if (title) bundle.title = title;
  if (description !== undefined) bundle.description = description;
  if (status && ['draft', 'published', 'archived'].includes(status)) {
    bundle.status = status;
  }
  if (tags && Array.isArray(tags)) bundle.tags = tags;
  
  await bundle.save();
  
  res.json({
    success: true,
    message: 'Bundle updated successfully',
    bundle,
  });
});

/**
 * @desc    Delete a lesson bundle (cascade deletes all components)
 * @route   DELETE /api/teacher/bundles/:id
 * @access  Private (Teacher)
 */
const deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await LessonBundle.findById(req.params.id);
  
  if (!bundle) {
    res.status(404);
    throw new Error('Bundle not found');
  }
  
  // Check authorization
  if (bundle.teacher.toString() !== req.user.id.toString()) {
    res.status(403);
    throw new Error('Not authorized to delete this bundle');
  }
  
  // The pre-remove middleware will handle cascade deletion
  await bundle.deleteOne();
  
  res.json({
    success: true,
    message: 'Bundle and all associated content deleted successfully',
    id: req.params.id,
  });
});

/**
 * @desc    Duplicate a bundle (creates a new copy with all components)
 * @route   POST /api/teacher/bundles/:id/duplicate
 * @access  Private (Teacher)
 */
const duplicateBundle = asyncHandler(async (req, res) => {
  const originalBundle = await LessonBundle.findById(req.params.id)
    .populate('lessonNote')
    .populate('learnerNote')
    .populate('quiz');
    
  if (!originalBundle) {
    res.status(404);
    throw new Error('Bundle not found');
  }
  
  // Check authorization
  if (originalBundle.teacher.toString() !== req.user.id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to duplicate this bundle');
  }
  
  console.log(`📋 Duplicating bundle: ${originalBundle._id}`);
  
  // Duplicate lesson note
  const newLessonNote = await LessonNote.create({
    teacher: req.user.id,
    school: req.user.school,
    subStrand: originalBundle.subStrand,
    content: originalBundle.lessonNote.content,
    aiProvider: originalBundle.lessonNote.aiProvider,
    aiModel: originalBundle.lessonNote.aiModel,
  });
  
  // Duplicate learner note
  const newLearnerNote = await LearnerNote.create({
    author: req.user.id,
    school: req.user.school,
    subStrand: originalBundle.subStrand,
    content: originalBundle.learnerNote.content,
    status: 'draft', // Always start as draft
    aiProvider: originalBundle.learnerNote.aiProvider,
    aiModel: originalBundle.learnerNote.aiModel,
  });
  
  // Duplicate quiz
  const newQuiz = await Quiz.create({
    title: `${originalBundle.quiz.title} (Copy)`,
    subject: originalBundle.quiz.subject,
    teacher: req.user.id,
    school: req.user.school,
    aiProvider: originalBundle.quiz.aiProvider,
    aiModel: originalBundle.quiz.aiModel,
  });
  
  // Duplicate all questions and options
  const originalQuestions = await Question.find({ quiz: originalBundle.quiz._id });
  
  for (const originalQuestion of originalQuestions) {
    const newQuestion = await Question.create({
      text: originalQuestion.text,
      explanation: originalQuestion.explanation,
      difficultyLevel: originalQuestion.difficultyLevel,
      topicTags: originalQuestion.topicTags,
      quiz: newQuiz._id,
    });
    
    // Duplicate options
    const originalOptions = await Option.find({ question: originalQuestion._id });
    for (const originalOption of originalOptions) {
      await Option.create({
        question: newQuestion._id,
        text: originalOption.text,
        isCorrect: originalOption.isCorrect,
      });
    }
  }
  
  // Link quiz to learner note
  newLearnerNote.quiz = newQuiz._id;
  await newLearnerNote.save();
  
  // Create new bundle
  const newBundle = await LessonBundle.create({
    teacher: req.user.id,
    school: req.user.school,
    subStrand: originalBundle.subStrand,
    title: `${originalBundle.title} (Copy)`,
    description: originalBundle.description,
    status: 'draft', // Always start as draft
    lessonNote: newLessonNote._id,
    learnerNote: newLearnerNote._id,
    quiz: newQuiz._id,
    generationContext: originalBundle.generationContext,
    tags: originalBundle.tags,
  });
  
  console.log(`✅ Bundle duplicated successfully: ${newBundle._id}`);
  
  res.status(201).json({
    success: true,
    message: 'Bundle duplicated successfully',
    bundle: newBundle,
  });
});

module.exports = {
  generateLessonNote,
  getMyLessonNotes,
  getLessonNoteById,
  deleteLessonNote,
  generateLearnerNote,
  generateLearnerNoteFromStrand,
  getMySchoolCalendar,
  createQuiz,
  uploadResource,
  getTeacherAnalytics,
  getDraftLearnerNotes,
  publishLearnerNote,
  deleteLearnerNote,
  searchImage,
  generateLessonBundle,
  getMyBundles,
  getBundleById,
  updateBundle,
  deleteBundle,
  duplicateBundle,
};