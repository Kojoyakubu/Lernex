const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const FIELD_ALIASES = {
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
    .filter((row) => Object.values(row).some((value) => clean(value)));
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

function htmlTablesToMatrix(html) {
  const tables = [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)];
  const matrix = [];
  tables.forEach((tableMatch) => {
    const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    rows.forEach((rowMatch) => {
      const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => clean(cell[1].replace(/<[^>]+>/g, ' ')));
      if (cells.length) matrix.push(cells);
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