// Increment Letter PDF - reproduces the company's own finalized Word
// template (Increment Letter- Rajeev Tiwari.docx) exactly: same page size/
// margins, same logo, same body copy and bold placement, same footer.
// Cambria (the template's body font) is a proprietary Microsoft font that
// can't be redistributed/bundled into this deployment, so Times-Roman/
// Times-Bold (pdfkit's built-in core fonts, same serif family) stand in
// for it - everything else here is pulled directly from the template's
// own XML (fonts, sizes, margins, colors, bold/underline placement).
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, 'assets', 'alcove-logo.png');

// Converted from the template's own w:pgMar (twips / 20 = points). Bottom
// is deliberately NOT the template's real 56.7 - pdfkit forces a page break
// on ANY text (even absolutely-positioned) that would extend past
// page.height - margins.bottom, which would otherwise push the footer (it
// sits further down than that, in the true bottom margin area Word reserves
// for footers) onto an unwanted second page. Kept small instead, since nothing
// here relies on pdfkit's own auto-pagination in the first place.
const MARGIN_TOP = 119.9;
const MARGIN_BOTTOM = 10;
const MARGIN_LEFT = 49.6;
const MARGIN_RIGHT = 42.55;

const BODY_FONT = 'Times-Roman';
const BODY_FONT_BOLD = 'Times-Bold';
const BODY_FONT_ITALIC = 'Times-Italic';
const BODY_SIZE = 11.5;

function ddmmyyyy(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d + '-' + m + '-' + y;
}

// Mixed bold/plain run within one flowing (wrapping) paragraph.
function writeMixed(doc, segments) {
  segments.forEach((seg, i) => {
    doc.font(seg.bold ? BODY_FONT_BOLD : BODY_FONT).fontSize(BODY_SIZE);
    const opts = { continued: i < segments.length - 1 };
    if (seg.underline) opts.underline = true;
    doc.text(seg.text, opts);
  });
}

function buildIncrementLetterPdf(fields) {
  const {
    title, employeeName, employeeId, department, companyName, refNo,
    currentDesignation, currentGross, revisedGross, currentNotice, revisedNotice,
    effectiveDate, incrementYear
  } = fields;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT }
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bodyWidth = doc.page.width - MARGIN_LEFT - MARGIN_RIGHT;
    const dateStr = ddmmyyyy(effectiveDate);

    // Logo - same size/position as the template's header (inline, left-
    // aligned, slightly left of the body's own left margin).
    doc.image(LOGO_PATH, 28, 21.25, { width: 110.25, height: 56.9 });

    doc.y = MARGIN_TOP;

    // Ref. No. / Date - one line, left part + right-aligned part. Combining
    // an align:'right' box with a continued chain garbles the two runs
    // together (pdfkit bug/quirk), so the right-aligned x is computed by
    // hand instead of relying on that combination.
    const refLineY = doc.y;
    doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('#000')
      .text('Ref. No: AR/HR/Inc./' + refNo, MARGIN_LEFT, refLineY);
    const dateLabel = 'Date: ';
    doc.font(BODY_FONT_BOLD).fontSize(BODY_SIZE);
    const dateLabelWidth = doc.widthOfString(dateLabel);
    doc.font(BODY_FONT).fontSize(BODY_SIZE);
    const dateValueWidth = doc.widthOfString(dateStr);
    const dateStartX = MARGIN_LEFT + bodyWidth - dateLabelWidth - dateValueWidth;
    doc.font(BODY_FONT_BOLD).text(dateLabel, dateStartX, refLineY, { continued: true, lineBreak: false });
    doc.font(BODY_FONT).text(dateStr, { lineBreak: false });
    // The positioned call above leaves doc.x wherever that line ended (near
    // the right margin) - every subsequent plain .text() call has no
    // explicit x, so without this reset they'd all inherit that leftover x
    // and word-wrap into a near-zero-width column.
    doc.x = MARGIN_LEFT;
    doc.y = refLineY + doc.currentLineHeight() + 2;
    doc.moveDown(2);

    // Recipient block.
    doc.font(BODY_FONT_BOLD).fontSize(BODY_SIZE);
    doc.text(title + ' ' + employeeName);
    doc.text('Emp ID: ' + employeeId);
    doc.text('Department: ' + department);
    doc.moveDown(1.5);

    // Subject - centered, bold, underlined.
    doc.font(BODY_FONT_BOLD).fontSize(BODY_SIZE).text('SUB: - Increment letter', { align: 'center', underline: true });
    doc.moveDown(1.5);

    // Salutation.
    doc.font(BODY_FONT_BOLD).fontSize(BODY_SIZE).text('Dear ' + title + ' ' + employeeName + ',');
    doc.moveDown(1.2);

    writeMixed(doc, [
      { text: 'We are pleased to inform you that your current designation is ' },
      { text: currentDesignation + '.', bold: true }
    ]);
    doc.moveDown(1.2);

    writeMixed(doc, [
      {
        text:
          'Congratulations on this well-deserved increment. We take this opportunity to congratulate you and ' +
          'express our appreciation for your valuable contribution to achieving company objectives. Specific ' +
          'terms relating to your monthly gross remuneration have been revised from '
      },
      { text: 'Rs. ' + currentGross + ' /-', bold: true },
      { text: ' to ' },
      { text: 'Rs. ' + revisedGross + '/-', bold: true },
      { text: ' & accordingly your notice period has been revised to ' },
      { text: revisedNotice, bold: true },
      { text: ' instead of ' + currentNotice + ', effective from ' + dateStr + '.' }
    ]);
    doc.moveDown(1.2);

    writeMixed(doc, [
      { text: 'You shall be eligible for your next increment in ' },
      { text: incrementYear, bold: true },
      { text: ', as per company policy.' }
    ]);
    doc.moveDown(1.2);

    doc.font(BODY_FONT).fontSize(BODY_SIZE)
      .text('We are confident that you will bring the same high level of professionalism and hard work to the role assigned to you.');
    doc.moveDown(1.2);

    doc.text('We hope that you will continue to put in your best efforts with greater zeal and enthusiasm during the ensuing year too.');
    doc.moveDown(1.2);

    doc.text('Wish you a rewarding career with us.');
    doc.moveDown(2.5);

    writeMixed(doc, [{ text: 'For ' }, { text: companyName, bold: true }]);
    doc.moveDown(2.5);

    doc.font(BODY_FONT_ITALIC).fontSize(BODY_SIZE).text('(Authorized Signatory)');

    // Footer - centered, Helvetica, matches the template's footer2 exactly
    // (same fixed address/contact block for every company; only the
    // company name itself changes).
    const footerY = doc.page.height - 42;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0070C0')
      .text(companyName, MARGIN_LEFT, footerY, { width: bodyWidth, align: 'center' });
    doc.fillColor('#000').fontSize(7).font('Helvetica')
      .text(
        'Ganapati, 68/2 Harish Mukherjee Road, Kolkata -700025  P +91 33 6684 2100  F +91 2455 7052  ' +
        'E hr@alcoverealty.in  W alcoverealty.in',
        MARGIN_LEFT, footerY + 12, { width: bodyWidth, align: 'center' }
      );

    doc.end();
  });
}

module.exports = { buildIncrementLetterPdf };
