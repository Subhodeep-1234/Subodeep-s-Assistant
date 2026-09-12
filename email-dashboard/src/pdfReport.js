// Minimal table-PDF builder (pdfkit) - purely for server-generated email
// attachments; the app's on-screen "Export PDF" buttons stay client-side
// (window.print()) and are untouched by this.
const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 28;

function buildTablePdfBuffer({ title, subtitle, columns, rows }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - PAGE_MARGIN * 2;
    const colWidth = pageWidth / columns.length;
    const rowHeight = 20;
    const headerHeight = 22;

    function drawHeader() {
      doc.fontSize(14).font('Helvetica-Bold').text(title, PAGE_MARGIN, PAGE_MARGIN);
      doc.fontSize(9).font('Helvetica').fillColor('#555')
        .text(subtitle, PAGE_MARGIN, PAGE_MARGIN + 18);
      doc.fillColor('#000');
      return PAGE_MARGIN + 40;
    }

    function drawTableHead(y) {
      doc.font('Helvetica-Bold').fontSize(8);
      columns.forEach((col, i) => {
        doc.text(col, PAGE_MARGIN + i * colWidth + 2, y + 5, { width: colWidth - 4 });
      });
      doc.moveTo(PAGE_MARGIN, y + headerHeight).lineTo(PAGE_MARGIN + pageWidth, y + headerHeight).strokeColor('#ccc').stroke();
      return y + headerHeight;
    }

    let y = drawHeader();
    y = drawTableHead(y);
    doc.font('Helvetica').fontSize(8);

    const bottomLimit = doc.page.height - PAGE_MARGIN;

    rows.forEach((row) => {
      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = PAGE_MARGIN;
        y = drawTableHead(y);
        doc.font('Helvetica').fontSize(8);
      }
      row.forEach((cell, i) => {
        doc.text(String(cell == null ? '' : cell), PAGE_MARGIN + i * colWidth + 2, y + 5, { width: colWidth - 4 });
      });
      y += rowHeight;
    });

    doc.end();
  });
}

module.exports = { buildTablePdfBuffer };
