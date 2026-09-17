const mongoose = require('mongoose');
const Scheme = require('../models/schemeModel');
const SubStrand = require('../models/subStrandModel');
const School = require('../models/schoolModel');
const User = require('../models/userModel');
const { findExistingLesson, generateLessonFromCurriculum } = require('./lessonGenerationService');

const TERM_NAMES = {
  one: 'First Term',
  first: 'First Term',
  two: 'Second Term',
  second: 'Second Term',
  three: 'Third Term',
  third: 'Third Term',
};

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeTerm = (value) => TERM_NAMES[normalize(value)] || String(value || '').trim();

function parseWeeks(requestText) {
  const text = normalize(requestText).replace(/[–—]/g, '-');
  const range = text.match(/weeks?\s+(\d+)\s*(?:to|through|-)\s*(\d+)/i);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  const single = text.match(/week\s+(\d+)/i);
  return single ? [Number(single[1])] : [];
}

function parseRequestedTerm(requestText) {
  const match = normalize(requestText).match(/(?:term|semester)\s+(one|two|three|first|second|third)/i);
  return match ? normalizeTerm(match[1]) : '';
}

function isAllRemainingRequest(requestText) {
  return /all\s+(?:my\s+)?remaining|remaining\s+lessons/i.test(requestText);
}

function isRegenerationRequest(requestText, regenerate) {
  return Boolean(regenerate) || /regenerate|generate again|replace existing/i.test(requestText);
}

function getWeekEnding(school, term, week) {
  const termKey = Object.entries(TERM_NAMES).find(([, value]) => value === term)?.[0];
  const weeks = termKey ? school?.termCalendar?.[termKey] || [] : [];
  return weeks.find((entry) => Number(entry.weekNumber) === Number(week))?.weekEnding || '';
}

function mondayFromWeekEnding(weekEnding) {
  if (!weekEnding) return '';
  const date = new Date(weekEnding);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - 4);
  return date.toISOString().slice(0, 10);
}

async function loadTeacherContext(teacherId) {
  const teacher = await User.findById(teacherId).select('fullName school').lean();
  if (!teacher) throw new Error('Teacher profile could not be found.');
  const school = teacher.school ? await School.findById(teacher.school).select('name termCalendar').lean() : null;
  if (!school) throw new Error('Your teacher profile is not linked to a school.');
  return { teacher, school };
}

async function findMatchingScheme({ teacherId, requestText, classId, subjectId, term }) {
  const schemes = await Scheme.find({
    teacher: teacherId,
    importStatus: 'confirmed',
    ...(classId ? { class: classId } : {}),
    ...(subjectId ? { subject: subjectId } : {}),
  }).populate('class', 'name').populate('subject', 'name').lean();

  const classMatches = classId
    ? schemes
    : schemes.filter((scheme) => normalize(requestText).includes(normalize(scheme.class?.name)));
  if (!classMatches.length) throw new Error('I could not find a confirmed scheme for the requested class.');

  const subjectMatches = subjectId
    ? classMatches
    : classMatches.filter((scheme) => normalize(requestText).includes(normalize(scheme.subject?.name)));
  if (!subjectMatches.length) throw new Error('I could not find a confirmed scheme for the requested subject.');

  const terms = [...new Set(subjectMatches.map((scheme) => scheme.term))];
  const requestedTerm = normalizeTerm(term || parseRequestedTerm(requestText));
  const termMatches = requestedTerm
    ? subjectMatches.filter((scheme) => normalize(scheme.term) === normalize(requestedTerm))
    : subjectMatches.filter((scheme) => terms.length === 1);

  if (!termMatches.length) {
    if (terms.length > 1) throw new Error(`Which term should I use: ${terms.join(', ')}?`);
    throw new Error('I could not find a confirmed scheme for that term.');
  }
  if (termMatches.length > 1) throw new Error('More than one confirmed scheme matches this request. Please specify the scheme or term.');
  return termMatches[0];
}

async function resolveSubStrand({ scheme, entry }) {
  const candidates = await SubStrand.find({
    name: new RegExp(`^${escapeRegex(entry.subStrand)}$`, 'i'),
  }).populate({ path: 'strand', populate: { path: 'subject', populate: { path: 'class' } } });
  const matching = candidates.filter((candidate) => (
    String(candidate.strand?.subject?._id) === String(scheme.subject._id)
    && String(candidate.strand?.subject?.class?._id) === String(scheme.class._id)
    && (!entry.strand || normalize(candidate.strand?.name) === normalize(entry.strand))
  ));
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) throw new Error(`More than one curriculum topic matches "${entry.subStrand}".`);
  throw new Error(`The scheme topic "${entry.subStrand}" is not mapped to the existing curriculum.`);
}

async function resolveWeeks({ scheme, requestText, weeks }) {
  if (weeks.length) return weeks;
  if (isAllRemainingRequest(requestText)) {
    const existing = await Promise.all(scheme.entries.flatMap((entry) => entry.weeks).map(async (week) => {
      const entry = scheme.entries.find((item) => item.weeks.includes(week));
      const subStrand = await resolveSubStrand({ scheme, entry });
      return findExistingLesson({ teacherId: scheme.teacher, subStrandId: subStrand._id, term: scheme.term, week });
    }));
    const existingWeeks = new Set(existing.filter(Boolean).map((lesson) => Number(lesson.generationContext.week)));
    return [...new Set(scheme.entries.flatMap((entry) => entry.weeks))].filter((week) => !existingWeeks.has(week)).sort((a, b) => a - b);
  }
  throw new Error('Please specify a week, week range, or “all remaining lessons”.');
}

async function generateFromRequest({ teacherId, requestText, classId, subjectId, term, weeks: requestedWeeks, regenerate = false }) {
  const { teacher, school } = await loadTeacherContext(teacherId);
  const scheme = await findMatchingScheme({ teacherId, requestText, classId, subjectId, term });
  const weeks = await resolveWeeks({ scheme, requestText, weeks: requestedWeeks?.length ? requestedWeeks : parseWeeks(requestText) });
  if (!weeks.length) throw new Error('No missing lessons remain for that scheme.');

  const shouldRegenerate = isRegenerationRequest(requestText, regenerate);
  const results = [];
  for (const week of weeks) {
    const entry = scheme.entries.find((item) => item.weeks.includes(Number(week)));
    if (!entry) {
      results.push({ week, status: 'failed', error: `No curriculum entry was found for Week ${week}.` });
      continue;
    }
    if (entry.needsReview) {
      results.push({ week, status: 'failed', error: `Week ${week} still requires curriculum review.` });
      continue;
    }
    try {
      const subStrand = await resolveSubStrand({ scheme, entry });
      const weekEnding = getWeekEnding(school, scheme.term, week);
      const result = await generateLessonFromCurriculum({
        teacherId,
        schoolId: teacher.school,
        schoolName: school.name,
        facilitatorName: teacher.fullName,
        curriculum: entry,
        subStrand,
        term: scheme.term,
        week,
        weekEnding,
        dayDate: mondayFromWeekEnding(weekEnding),
        sessionsPerWeek: 1,
        regenerate: shouldRegenerate,
      });
      results.push({ week, status: result.status, lessonId: result.lesson._id });
    } catch (error) {
      results.push({ week, status: 'failed', error: error.message });
    }
  }

  return {
    request: requestText,
    class: scheme.class,
    subject: scheme.subject,
    term: scheme.term,
    weeks,
    results,
    summary: {
      requested: weeks.length,
      generated: results.filter((result) => ['generated', 'regenerated'].includes(result.status)).length,
      existing: results.filter((result) => result.status === 'existing').length,
      failed: results.filter((result) => result.status === 'failed').length,
    },
  };
}

module.exports = {
  generateFromRequest,
  parseWeeks,
  parseRequestedTerm,
};