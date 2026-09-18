const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const FIELD_ALIASES = {
  subject: ['subject', 'subjects', 'learning area subject', 'course'],
  weeks: ['week', 'weeks', 'week number', 'week no'],
  strand: ['strand', 'learning area'],
  subStrand: ['sub strand', 'sub-strand', 'sub-strands', 'substrand', 'sub strands'],
  contentStandard: ['content standard', 'content standards', 'standard', 'content standard code'],
  indicators: ['indicator', 'indicators', 'performance indicator', 'performance indicators'],
  topic: ['topic', 'lesson topic'],
  activities: ['activity', 'activities', 'suggested activity', 'suggested activities'],
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeHeader = (value) => clean(value).toLowerCase().replace(/[_.:]+/g, ' ').replace(/\s+/g, ' ');

function resolveField(header) {
  const normalized = normalizeHeader(header).replace(/[–—]/g, '-');
  return Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || null;
}

function parseWeeks(value) {
  const text = clean(value).replace(/[–—]/g, '-').replace(/^weeks?\s*/i, '');
  if (!text) return [];
  const weeks = new Set();
  text.split(/[,;&]+|\s+-\s*/).forEach((part) => {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      for (let week = Number(range[1]); week <= Number(range[2]); week += 1) weeks.add(week);
      return;
    }
    const week = Number(part.trim());
    if (Number.isInteger(week) && week > 0) weeks.add(week);
  });
  return [...weeks].sort((a, b) => a - b);
}

function splitIndicators(value) {
  return clean(value)
    .split(/\n|\r|;|\|(?=\s*[A-Za-z]?\d)/)
    .map(clean)
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([A-Za-z]?\d+(?:\.\d+){1,})(?:\s*[-:.)]\s*|\s+)(.*)$/);
      return match ? { code: clean(match[1]), description: clean(match[2]) } : { code: '', description: item };
    });
}

function rowsFromMatrix(matrix) {
  const rows = matrix.map((row) => row.map(clean));
  const headerIndex = rows.findIndex((row) => row.filter((cell) => resolveField(cell)).length >= 2);
  if (headerIndex < 0) throw new Error('We could not identify the scheme columns.');
  const headers = rows[headerIndex].map(resolveField);
  return rows.slice(headerIndex + 1)
    .map((row, offset) => {
      const record = {};
      headers.forEach((field, index) => { if (field && row[index]) record[field] = row[index]; });
      return { ...record, sourceRow: headerIndex + offset + 2 };
    })
    .filter((row) => Object.values(row).some((value) => clean(value)))
    .filter((row) => normalizeHeader(row.weeks) !== 'weeks');
}

function toEntries(rows) {
  return rows.flatMap((row) => {
    const weeks = parseWeeks(row.weeks);
    const indicators = splitIndicators(row.indicators);
    const reviewReasons = [];
    if (!weeks.length) reviewReasons.push('Week is missing or unclear.');
    if (!row.strand) reviewReasons.push('Strand is missing.');
    if (!row.subStrand) reviewReasons.push('Sub-strand is missing.');
    if (!row.contentStandard) reviewReasons.push('Content standard is missing.');
    if (!indicators.length) reviewReasons.push('Indicator is missing.');

    return [{
      weeks,
      strand: clean(row.strand),
      subject: clean(row.subject),
      subStrand: clean(row.subStrand),
      contentStandard: clean(row.contentStandard),
      indicators,
      topic: clean(row.topic),
      activities: clean(row.activities),
      sourceRow: row.sourceRow,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    }];
  });
}

function extractSubjectLabel(html) {
  const titleMatch = String(html).match(/annual\s+scheme\s+of\s+learning\s*[-:–—]+\s*([^<]+)/i);
  if (titleMatch) {
    return clean(titleMatch[1])
      .replace(/\s*[–—-]\s*20\d{2}\s*[\/\-]\s*20\d{2}.*$/i, '')
      .replace(/\s*[–—-]\s*basic\s*\d+.*$/i, '')
      .trim();
  }
  const subjectMatches = [...String(html).matchAll(/(?:subject|learning area)\s*[:\-]\s*([^<\n]+)/gi)];
  if (subjectMatches.length) return clean(subjectMatches[subjectMatches.length - 1][1]);

  const headingMatches = [...String(html).matchAll(/<(?:h[1-6]|p)[^>]*>([\s\S]*?)<\/(?:h[1-6]|p)>/gi)]
    .map((match) => clean(match[1].replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
  const ignoredHeadings = new Set([
    'scheme of learning',
    'scheme of work',
    'weeks',
    'week',
    'strand',
    'sub-strand',
    'sub strand',
    'content standard',
    'indicators',
    'first term',
    'second term',
    'third term',
  ]);
  const candidate = headingMatches.reverse().find((heading) => {
    const normalized = normalizeHeader(heading);
    return !ignoredHeadings.has(normalized)
      && heading.length <= 80
      && !/^basic\s+\d+|^jhs\s+\d+|^term\b|^class\b/i.test(heading);
  });
  return candidate ? candidate.replace(/^(?:subject|learning area)\s*[:\-]?\s*/i, '') : '';
}

function htmlTablesToMatrix(html) {
  const tables = [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)];
  const matrix = [];
  let structuredTableFound = false;
  let currentWeek = '';
  const documentSubject = extractSubjectLabel(html);
  tables.forEach((tableMatch) => {
    const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    const parsedRows = rows.map((rowMatch) => [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => clean(cell[1].replace(/<[^>]+>/g, ' '))));
    const firstRowFields = parsedRows[0]?.map(resolveField).filter(Boolean) || [];
    const isStructuredHeader = firstRowFields.length >= 4
      && firstRowFields.includes('weeks')
      && firstRowFields.includes('strand')
      && firstRowFields.includes('subStrand');
    if (isStructuredHeader) structuredTableFound = true;
    if (!structuredTableFound) return;

    parsedRows.forEach((cells, rowIndex) => {
      if (!cells.length) return;
      if (isStructuredHeader && rowIndex === 0) {
        matrix.push(documentSubject && !cells.some((cell) => resolveField(cell) === 'subject')
          ? ['Subject', ...cells]
          : cells);
        return;
      }
      if (documentSubject && !matrix[0]?.some((cell) => resolveField(cell) === 'subject')) {
        matrix[0].unshift('Subject');
      }
      if (cells.length === 4 && currentWeek) {
        cells.unshift(currentWeek);
      } else if (cells.length >= 5 && !parseWeeks(cells[0]).length && currentWeek) {
        cells[0] = currentWeek;
      }
      if (parseWeeks(cells[0]).length) currentWeek = cells[0];
      if (documentSubject) {
        matrix.push([documentSubject, ...cells]);
      } else {
        matrix.push(cells);
      }
    });
  });
  return matrix;
}

async function extractMatrix(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (['.xlsx', '.xls', '.csv'].includes(extension)) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  }
  if (extension === '.docx') {
    const result = await mammoth.convertToHtml({ buffer: file.buffer });
    return htmlTablesToMatrix(result.value);
  }
  if (extension === '.pdf') {
    const result = await pdfParse(file.buffer);
    return result.text.split(/\r?\n/).map((line) => line.split(/\s{2,}|\t/));
  }
  throw new Error('Unsupported scheme file type. Use DOCX, XLSX, XLS, PDF, or CSV.');
}

async function parseSchemeFile(file) {
  const matrix = await extractMatrix(file);
  return toEntries(rowsFromMatrix(matrix));
}

module.exports = { parseSchemeFile, parseWeeks, resolveField };