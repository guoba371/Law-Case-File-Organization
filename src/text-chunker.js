const crypto = require('node:crypto');
const { CASE_LIMITS } = require('./case-config');

function stableChunkId(fileId, index, startChar, endChar) {
  return crypto.createHash('sha256').update(`${fileId}:${index}:${startChar}:${endChar}`).digest('hex').slice(0, 20);
}

function pageRange(pages, startChar, endChar) {
  if (!Array.isArray(pages) || pages.length === 0) return { pageStart: null, pageEnd: null };
  const overlaps = pages.filter((page) => page.endChar > startChar && page.startChar < endChar);
  if (!overlaps.length) return { pageStart: null, pageEnd: null };
  return { pageStart: overlaps[0].page, pageEnd: overlaps.at(-1).page };
}

function preferredEnd(text, start, hardEnd) {
  if (hardEnd >= text.length) return text.length;
  const minimum = start + Math.floor(CASE_LIMITS.textChunkChars * 0.65);
  const paragraphEnd = text.lastIndexOf('\n\n', hardEnd);
  if (paragraphEnd >= minimum) return paragraphEnd + 2;
  const lineEnd = text.lastIndexOf('\n', hardEnd);
  if (lineEnd >= minimum) return lineEnd + 1;
  return hardEnd;
}

function chunkText(input) {
  const text = String(input?.text || '');
  if (!text.trim()) return [];
  const chunks = [];
  let startChar = 0;
  let index = 0;

  while (startChar < text.length) {
    const hardEnd = Math.min(text.length, startChar + CASE_LIMITS.textChunkChars);
    const endChar = preferredEnd(text, startChar, hardEnd);
    const range = pageRange(input.pages, startChar, endChar);
    chunks.push({
      id: stableChunkId(input.fileId, index, startChar, endChar),
      fileId: input.fileId,
      fileName: input.fileName,
      index,
      startChar,
      endChar,
      ...range,
      text: text.slice(startChar, endChar),
    });
    if (endChar >= text.length) break;
    startChar = Math.max(0, endChar - CASE_LIMITS.textOverlapChars);
    index += 1;
  }
  return chunks;
}

module.exports = { chunkText, pageRange, stableChunkId };
