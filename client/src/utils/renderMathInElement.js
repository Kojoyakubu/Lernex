import renderMath from 'katex/contrib/auto-render';

const delimiters = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
];

export default function renderMathInElement(element) {
  if (!element) return;

  try {
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