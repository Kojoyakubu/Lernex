import renderMath from 'katex/contrib/auto-render';

const delimiters = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
];

function normalizeMathDelimiters(rawHtml = '') {
  return String(rawHtml || '')
    .replace(/\\\\\(/g, '\\(')
    .replace(/\\\\\)/g, '\\)')
    .replace(/\\\\\[/g, '\\[')
    .replace(/\\\\\]/g, '\\]')
    .replace(/\\\s+\(/g, '\\(')
    .replace(/\\\s+\)/g, '\\)')
    .replace(/\\\s+\[/g, '\\[')
    .replace(/\\\s+\]/g, '\\]')
    .replace(/&bsol;\(/gi, '\\(')
    .replace(/&bsol;\)/gi, '\\)')
    .replace(/&bsol;\[/gi, '\\[')
    .replace(/&bsol;\]/gi, '\\]');
}

export default function renderMathInElement(element) {
  if (!element) return;

  try {
    const normalizedHtml = normalizeMathDelimiters(element.innerHTML);
    if (normalizedHtml !== element.innerHTML) {
      element.innerHTML = normalizedHtml;
    }

    renderMath(element, {
      delimiters,
      throwOnError: false,
      strict: 'ignore',
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      ignoredClasses: ['no-math-render'],
    });
  } catch (error) {
    console.error('Failed to render math content:', error);
  }
}