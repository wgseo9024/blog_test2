export const normalizeTags = (tags) => Array.isArray(tags)
  ? [...new Set(tags.map((tag) => String(tag || "").trim()).filter(Boolean))] : [];

export function validateWriterOutput(value) {
  const issues = [];
  const blocks = Array.isArray(value?.bodyBlocks) ? value.bodyBlocks.map((v) => String(v).trim()) : [];
  const tags = normalizeTags(value?.tags);
  if (blocks.length !== 7) issues.push({ code: "BODY_BLOCK_COUNT", message: "bodyBlocks는 정확히 7개여야 합니다." });
  if (blocks.some((block) => !block || /\n/.test(block))) issues.push({ code: "BODY_BLOCK_SENTENCE", message: "각 block은 줄바꿈 없는 완결 문장이어야 합니다." });
  const length = blocks.join("").length;
  if (length < 700 || length > 800) issues.push({ code: "BODY_LENGTH", message: `본문은 700~800자여야 합니다(현재 ${length}자).` });
  if (tags.length !== 10) issues.push({ code: "TAG_COUNT", message: "중복을 제외한 tags는 정확히 10개여야 합니다." });
  if (tags.some((tag) => tag.includes("#"))) issues.push({ code: "TAG_HASH", message: "태그에 #을 넣을 수 없습니다." });
  return { valid: issues.length === 0, issues, bodyBlocks: blocks, tags, characterCount: length };
}

export function renderDraft(bodyBlocks, tags, imageUrls = []) {
  const lines = [];
  for (let i = 0; i < 7; i += 1) {
    if (i < 4 && imageUrls[i]) lines.push(imageUrls[i]);
    lines.push(bodyBlocks[i] || "", "");
  }
  lines.push(tags.map((tag) => `#${tag}`).join(" "));
  return lines.join("\n").trim();
}

export async function validateWithOneRevision(initialDraft, validate, revise) {
  const first = await validate(initialDraft);
  if (first.valid) return { draft: initialDraft, validation: first, revised: false, reviewRequired: false };
  const revisedDraft = await revise(initialDraft, first.issues);
  const second = await validate(revisedDraft);
  return { draft: revisedDraft, validation: second, revised: true, reviewRequired: !second.valid };
}
