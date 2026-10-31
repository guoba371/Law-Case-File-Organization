const CASE_LIMITS = Object.freeze({
  maxFileBytes: 100 * 1024 * 1024,
  maxFiles: 500,
  maxCaseBytes: 2 * 1024 * 1024 * 1024,
  uploadChunkBytes: 5 * 1024 * 1024,
  textChunkChars: 12_000,
  textOverlapChars: 500,
});

module.exports = { CASE_LIMITS };
