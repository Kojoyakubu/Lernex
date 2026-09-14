const sanitizeFileName = (topic, fallbackExtension) => {
  const baseName = String(topic || 'document')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${baseName || 'document'}.${fallbackExtension}`;
};

const normalizeMargins = (margin) => {
  if (Array.isArray(margin) && margin.length === 4) {
    return {
      top: margin[0],
      left: margin[1],
      bottom: margin[2],
      right: margin[3],
    };
  }

  const numericMargin = typeof margin === 'number' ? margin : 10;

  return {
    top: numericMargin,
    left: numericMargin,
    bottom: numericMargin,
    right: numericMargin,
  };
};

const triggerDownload = (blob, fileName) => {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);

  link.href = objectUrl;
  link.download = fileName;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
};

export const downloadAsPdf = async (elementId, topic, options = {}) => {
  const element = document.getElementById(elementId);
  if (!element) return null;

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const defaultOptions = {
    margin: [6, 4, 6, 4],
    filename: sanitizeFileName(topic, 'pdf'),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  const mergedOptions = {
    ...defaultOptions,
    ...options,
    image: {
      ...defaultOptions.image,
      ...(options.image || {}),
    },
    html2canvas: {
      ...defaultOptions.html2canvas,
      ...(options.html2canvas || {}),
    },
    jsPDF: {
      ...defaultOptions.jsPDF,
      ...(options.jsPDF || {}),
    },
  };

  const canvas = await html2canvas(element, mergedOptions.html2canvas);
  const pdf = new jsPDF(mergedOptions.jsPDF);
  const margins = normalizeMargins(mergedOptions.margin);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const printableWidth = pageWidth - margins.left - margins.right;
  const printableHeight = pageHeight - margins.top - margins.bottom;
  const imageType = (mergedOptions.image.type || 'jpeg').toUpperCase();
  const imageData = canvas.toDataURL(`image/${mergedOptions.image.type || 'jpeg'}`, mergedOptions.image.quality);
  const renderedHeight = (canvas.height * printableWidth) / canvas.width;

  const requestedMaxPages = Number(mergedOptions.maxPages);
  const maxPages = Number.isFinite(requestedMaxPages) && requestedMaxPages > 0
    ? Math.floor(requestedMaxPages)
    : null;

  let drawWidth = printableWidth;
  let drawHeight = renderedHeight;

  if (maxPages) {
    const maxRenderableHeight = printableHeight * maxPages;
    if (drawHeight > maxRenderableHeight) {
      const fitScale = maxRenderableHeight / drawHeight;
      drawWidth *= fitScale;
      drawHeight *= fitScale;
    }
  }

  const drawX = margins.left + (printableWidth - drawWidth) / 2;

  const pageEpsilon = 0.01;
  let remainingHeight = drawHeight;
  let currentPage = 1;
  let offsetY = margins.top;

  pdf.addImage(imageData, imageType, drawX, offsetY, drawWidth, drawHeight);
  remainingHeight -= printableHeight;

  while (remainingHeight > pageEpsilon) {
    if (maxPages && currentPage >= maxPages) {
      break;
    }

    offsetY = remainingHeight - drawHeight + margins.top;
    pdf.addPage();
    pdf.addImage(imageData, imageType, drawX, offsetY, drawWidth, drawHeight);
    remainingHeight -= printableHeight;
    currentPage += 1;
  }

  pdf.save(mergedOptions.filename);
  return pdf;
};

export const downloadAsWord = async (elementId, topic) => {
  const element = document.getElementById(elementId);
  if (!element) return null;

  const exportRoot = element.cloneNode(true);
  exportRoot.classList.add('word-export');

  // Word treats table header rows as repeating print headers. Keep the lesson
  // phase labels as a normal row so they appear once instead of on every page.
  exportRoot.querySelectorAll('.lesson-phases .phase-table thead').forEach((thead) => {
    const body = document.createElement('tbody');
    while (thead.firstChild) body.appendChild(thead.firstChild);
    thead.replaceWith(body);
  });

  exportRoot.querySelectorAll('.lesson-phases .phase-table').forEach((table) => {
    const colgroup = document.createElement('colgroup');
    ['25%', '50%', '25%'].forEach((width) => {
      const col = document.createElement('col');
      col.style.width = width;
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
  });

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          @page {
            size: A4;
            margin: 0.45in;
          }
          html, body {
            margin: 0;
            padding: 0;
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.25;
          }
          .word-export,
          .word-export * {
            font-family: Arial, sans-serif !important;
            font-size: 10pt !important;
            line-height: 1.25 !important;
          }
          .word-export h1,
          .word-export h2,
          .word-export h3,
          .word-export h4,
          .word-export strong {
            font-size: 11pt !important;
          }
          .word-export {
            margin: 0;
            padding: 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            page-break-inside: auto;
            table-layout: fixed;
          }
          .word-export .phase-table col:nth-child(1) { width: 25% !important; }
          .word-export .phase-table col:nth-child(2) { width: 50% !important; }
          .word-export .phase-table col:nth-child(3) { width: 25% !important; }
          tr { page-break-inside: avoid; }
          th, td {
            border: 1px solid #000;
            padding: 2pt 3pt;
            vertical-align: top;
            min-width: 0;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          .word-export .katex-display { max-width: 100%; overflow-wrap: anywhere; white-space: normal; font-size: 0.85em !important; }
          .word-export svg { max-width: 100%; height: auto; }
          img {
            max-width: 100%;
            height: auto;
          }
        </style>
      </head>
      <body>
        ${exportRoot.outerHTML}
      </body>
    </html>
  `;

  const blob = new Blob([html], {
    type: 'application/msword;charset=utf-8',
  });
  const fileName = sanitizeFileName(topic, 'doc');

  triggerDownload(blob, fileName);
  return blob;
};
