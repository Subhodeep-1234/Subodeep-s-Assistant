// Table-PDF builder (pdfkit) for server-generated email attachments (e.g.
// the Exits "Send Mail" button) - styled to match the app's own on-screen
// "Export PDF" print report exactly (see the @media print rules for
// #printReport in workforce.css): teal title + gray meta line under a teal
// rule, a fully-bordered table with an uppercase teal header row and
// zebra-striped body rows. The on-screen "Export PDF" buttons themselves
// stay client-side (window.print()) and are untouched by this - this is
// only for a PDF that has to exist as a real file to attach to an email.
const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 28;
const COLOR_TITLE = '#1d5c63';
const COLOR_META = '#5b6169';
const COLOR_BORDER = '#c3ccc8';
const COLOR_HEADER_BG = '#eef0ed';
const COLOR_ZEBRA = '#f7f9f8';

function buildTablePdfBuffer({ title, subtitle, columns, rows }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - PAGE_MARGIN * 2;
    const colWidth = pageWidth / columns.length;
    const rowHeight = 22;
    const headerRowHeight = 24;
    const cellPaddingX = 7;

    function drawHeader() {
      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLOR_TITLE).text(title, PAGE_MARGIN, PAGE_MARGIN);
      doc.fontSize(9).font('Helvetica').fillColor(COLOR_META).text(subtitle, PAGE_MARGIN, PAGE_MARGIN + 20);
      const ruleY = PAGE_MARGIN + 38;
      doc.moveTo(PAGE_MARGIN, ruleY).lineTo(PAGE_MARGIN + pageWidth, ruleY)
        .lineWidth(1.5).strokeColor(COLOR_TITLE).stroke();
      doc.fillColor('#000').lineWidth(0.5);
      return ruleY + 14;
    }

    // Every cell gets a full border on all sides, matching
    // "#printReport th, #printReport td { border: 1px solid #c3ccc8; }".
    function drawGridLines(y, height) {
      doc.strokeColor(COLOR_BORDER).lineWidth(0.5);
      for (let i = 0; i <= columns.length; i++) {
        const x = PAGE_MARGIN + i * colWidth;
        doc.moveTo(x, y).lineTo(x, y + height).stroke();
      }
      doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + pageWidth, y).stroke();
      doc.moveTo(PAGE_MARGIN, y + height).lineTo(PAGE_MARGIN + pageWidth, y + height).stroke();
    }

    function drawTableHead(y) {
      doc.rect(PAGE_MARGIN, y, pageWidth, headerRowHeight).fill(COLOR_HEADER_BG);
      drawGridLines(y, headerRowHeight);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR_TITLE);
      columns.forEach((col, i) => {
        doc.text(String(col).toUpperCase(), PAGE_MARGIN + i * colWidth + cellPaddingX, y + 8, {
          width: colWidth - cellPaddingX * 2,
          characterSpacing: 0.3
        });
      });
      doc.fillColor('#000');
      return y + headerRowHeight;
    }

    let y = drawHeader();
    y = drawTableHead(y);

    const bottomLimit = doc.page.height - PAGE_MARGIN;

    rows.forEach((row, rowIndex) => {
      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = PAGE_MARGIN;
        y = drawTableHead(y);
      }
      // nth-child(even) in the CSS (1-indexed) = odd rowIndex here (0-indexed).
      if (rowIndex % 2 === 1) {
        doc.rect(PAGE_MARGIN, y, pageWidth, rowHeight).fill(COLOR_ZEBRA);
      }
      drawGridLines(y, rowHeight);
      doc.font('Helvetica').fontSize(8).fillColor('#000');
      row.forEach((cell, i) => {
        doc.text(String(cell == null ? '' : cell), PAGE_MARGIN + i * colWidth + cellPaddingX, y + 6, {
          width: colWidth - cellPaddingX * 2
        });
      });
      y += rowHeight;
    });

    doc.end();
  });
}

module.exports = { buildTablePdfBuffer };
