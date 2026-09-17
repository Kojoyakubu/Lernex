const LessonNote = require('../models/lessonNoteModel');
const aiService = require('./aiService');

const buildIndicatorText = (indicators = []) => indicators
  .map((indicator) => [indicator.code, indicator.description].filter(Boolean).join(' - '))
  .filter(Boolean)
  .join('\n');

const hasUsableLessonContent = (content = '') => {
  const normalized = String(content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length >= 100;
};

async function findExistingLesson({ teacherId, subStrandId, term, week }) {
  return LessonNote.findOne({
    teacher: teacherId,
    subStrand: subStrandId,
    'generationContext.term': term,
    'generationContext.week': String(week),
  }).sort({ createdAt: -1 });
}

async function generateLessonFromCurriculum({
  teacherId,
  schoolId,
  schoolName,
  facilitatorName,
  curriculum,
  subStrand,
  term,
  week,
  weekEnding = '',
  dayDate = '',
  duration = '',
  classSize = '',
  sessionsPerWeek = 1,
  sessionPlan = '',
  reference = '',
  regenerate = false,
  generationMethod = 'AI Automation Agent',
}) {
  const existingLesson = await findExistingLesson({
    teacherId,
    subStrandId: subStrand._id,
    term,
    week,
  });
  if (existingLesson && !regenerate) {
    return { status: 'existing', lesson: existingLesson };
  }

  const indicatorCodes = buildIndicatorText(curriculum.indicators);
  const details = {
    school: schoolName || '',
    facilitatorName: facilitatorName || '',
    term,
    week: String(week),
    weekEnding,
    dayDate,
    duration,
    classSize,
    contentStandardCode: curriculum.contentStandard || '',
    indicatorCodes,
    reference: reference || curriculum.activities || '',
    sessionsPerWeek: sessionsPerWeek || 1,
    sessionPlan,
    strandName: curriculum.strand || subStrand.strand?.name || 'N/A',
    subStrandName: curriculum.subStrand || subStrand.name || 'N/A',
    subjectName: subStrand.strand?.subject?.name || 'N/A',
    className: subStrand.strand?.subject?.class?.name || 'N/A',
  };

  const generated = await aiService.generateTeacherLessonNoteHTML(details);
  if (!hasUsableLessonContent(generated.text)) {
    throw new Error('The generated lesson was empty or too short to save.');
  }

  const lesson = await LessonNote.create({
    teacher: teacherId,
    school: schoolId,
    subStrand: subStrand._id,
    content: generated.text,
    generationContext: {
      facilitatorName: details.facilitatorName,
      term: details.term,
      week: details.week,
      weekEnding: details.weekEnding,
      dayDate: details.dayDate,
      duration: details.duration,
      classSize: details.classSize || null,
      contentStandardCode: details.contentStandardCode,
      indicatorCodes: details.indicatorCodes,
      reference: details.reference,
      sessionsPerWeek: details.sessionsPerWeek,
      sessionPlan: details.sessionPlan,
      classId: subStrand.strand?.subject?.class?._id,
      subjectId: subStrand.strand?.subject?._id,
      strandName: details.strandName,
      subStrandName: details.subStrandName,
      curriculumEntryId: curriculum._id,
      generationMethod,
    },
    aiProvider: generated.provider,
    aiModel: generated.model,
    aiGeneratedAt: new Date(generated.timestamp),
  });

  return { status: existingLesson ? 'regenerated' : 'generated', lesson };
}

module.exports = {
  buildIndicatorText,
  findExistingLesson,
  generateLessonFromCurriculum,
};