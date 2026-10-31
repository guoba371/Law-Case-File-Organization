const fs = require('node:fs');
const {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} = require('docx');
const PDFDocument = require('pdfkit');

const PDF_FONT = 'C:\\Windows\\Fonts\\simhei.ttf';

function cleanText(value) {
  return String(value || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeFileStem(value) {
  return String(value || '文书')
    .replace(/\.(pdf|docx|txt)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || '文书';
}

function fileNameFor(doc, format) {
  return `${safeFileStem(doc.caseFileName)}-${safeFileStem(doc.typeName)}.${format}`;
}

function metadataLines(doc) {
  return [
    `案卷：${safeFileStem(doc.caseFileName)}`,
    `生成时间：${new Date(doc.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `分析模型：${doc.model}`,
  ];
}

async function createDocx(doc) {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [new TextRun({ text: doc.typeName, bold: true, size: 34, font: 'Microsoft YaHei' })],
    }),
    ...metadataLines(doc).map((line) => new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: line, size: 19, color: '666666', font: 'Microsoft YaHei' })],
    })),
    new Paragraph({ spacing: { after: 180 } }),
  ];

  for (const section of doc.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: false,
      keepNext: true,
      spacing: { before: 240, after: 140 },
      children: [new TextRun({ text: section.title, bold: true, size: 26, color: '000000', font: 'Microsoft YaHei' })],
    }));

    const paragraphs = cleanText(section.content).split(/\n+/).filter(Boolean);
    for (const text of paragraphs) {
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: 420, after: 120 },
        indent: { firstLine: 480 },
        children: [new TextRun({ text, size: 23, font: 'SimSun' })],
      }));
    }
  }

  const wordDoc = new Document({
    styles: { default: { document: { run: { font: 'SimSun', size: 23 } } } },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: '第 ', size: 18, color: '777777' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '777777' }),
              new TextRun({ text: ' 页', size: 18, color: '777777' }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(wordDoc);
}

function createPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 64, right: 64, bottom: 64, left: 64 },
      info: { Title: doc.typeName, Author: '案卷研判' },
      bufferPages: true,
    });

    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    if (!fs.existsSync(PDF_FONT)) {
      reject(new Error('PDF 中文字体不存在'));
      return;
    }

    pdf.registerFont('Chinese', PDF_FONT);
    pdf.font('Chinese').fontSize(20).text(doc.typeName, { align: 'center' });
    pdf.moveDown(0.7);
    pdf.fontSize(9).fillColor('#666666');
    for (const line of metadataLines(doc)) pdf.text(line, { align: 'center' });
    pdf.moveDown(1.2).fillColor('#000000');

    for (const section of doc.sections) {
      pdf.fontSize(14).text(section.title, { lineGap: 5 });
      pdf.moveDown(0.35);
      pdf.fontSize(11).text(cleanText(section.content), {
        align: 'justify',
        indent: 22,
        lineGap: 7,
        paragraphGap: 8,
      });
      pdf.moveDown(0.7);
    }

    const range = pdf.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      pdf.switchToPage(index);
      pdf.fontSize(9).fillColor('#777777').text(
        `第 ${index + 1} 页 / 共 ${range.count} 页`,
        64,
        pdf.page.height - 42,
        { width: pdf.page.width - 128, align: 'center' },
      );
    }

    pdf.end();
  });
}

async function exportDocument(doc, format) {
  if (format === 'docx') {
    return {
      buffer: await createDocx(doc),
      fileName: fileNameFor(doc, 'docx'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (format === 'pdf') {
    return {
      buffer: await createPdf(doc),
      fileName: fileNameFor(doc, 'pdf'),
      contentType: 'application/pdf',
    };
  }
  throw new Error('仅支持 Word 或 PDF 格式');
}

module.exports = { cleanText, exportDocument, fileNameFor };
