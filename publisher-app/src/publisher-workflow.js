import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { editorSelectors, firstVisible } from "./naver-selectors.js";

export const MAX_IMAGE_COUNT = 4;
export const MIN_BODY_BLOCKS = 7;
export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
export const imageBlockSelector = ".se-component.se-image, [data-module=\"image\"]";
export const imageResourceSelector = ".se-image-resource, .se-module-image img";
export const textBlockSelector = [
  '.se-text-paragraph',
  '.se-component.se-text',
  '.se-component-content [contenteditable="true"]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[data-placeholder*="본문"]',
  '[data-placeholder*="내용"]',
].join(", ");

export class PublisherStageError extends Error {
  constructor(stage, message, result = "retry") {
    super(message);
    this.name = "PublisherStageError";
    this.stage = stage;
    this.result = result;
  }
}

export function validateDraftAssets(draft) {
  if (!Array.isArray(draft?.body_blocks) || draft.body_blocks.length < MIN_BODY_BLOCKS) {
    throw new PublisherStageError("body_blocks_validation", "body_blocks_json이 없거나 본문 문장 블록이 7개 미만입니다.");
  }
  if (draft.body_blocks.some((block) => !String(block || "").trim())) {
    throw new PublisherStageError("body_blocks_validation", "본문 문장 블록에 빈 문장이 있습니다.");
  }
  if (!Array.isArray(draft?.images) || draft.images.length < 1) {
    throw new PublisherStageError("image_count_validation", "승인된 처리 이미지가 없습니다.", "image_pending");
  }
  return { bodyBlocks: draft.body_blocks.map((block) => String(block).trim()), images: draft.images.slice(0, MAX_IMAGE_COUNT) };
}

function extensionFor(contentType) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[contentType] || null;
}

function hasExpectedSignature(buffer, contentType) {
  if (contentType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  if (contentType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return false;
}

export async function downloadApprovedImages(draft, { baseUrl, token, tmpRoot, fetchImpl = fetch }) {
  const { images } = validateDraftAssets(draft);
  const directory = path.join(tmpRoot, `draft-${draft.id}`);
  await mkdir(directory, { recursive: true });
  const files = [];
  try {
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const url = new URL(image.download_url, baseUrl);
      if (url.origin !== new URL(baseUrl).origin) throw new PublisherStageError("image_download", "이미지 다운로드 URL이 API origin과 다릅니다.");
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "image/jpeg,image/png,image/webp" } });
      const contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
      const extension = extensionFor(contentType);
      const announcedSize = Number(response.headers.get("content-length") || 0);
      if (!response.ok || !extension || announcedSize > MAX_DOWNLOAD_BYTES) throw new PublisherStageError("image_download", `승인 이미지 ${index + 1} 다운로드 응답이 올바르지 않습니다.`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES || !hasExpectedSignature(buffer, contentType)) {
        throw new PublisherStageError("image_download", `승인 이미지 ${index + 1}의 형식 또는 크기가 올바르지 않습니다.`);
      }
      const generatedHomeThumbnail = image.source === "AI 홈판";
      const outputBuffer = generatedHomeThumbnail
        ? await (await import("sharp")).default(buffer).resize(1080, 1080, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer()
        : buffer;
      const filePath = path.join(directory, `image-${index + 1}${generatedHomeThumbnail ? ".jpg" : extension}`);
      await writeFile(filePath, outputBuffer);
      files.push(filePath);
    }
    return { directory, files };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupDraftImages(directory) {
  if (directory) await rm(directory, { recursive: true, force: true });
}

export async function imageBlockCount(frame) {
  return frame.locator(imageBlockSelector).count();
}

async function editableTextCandidates(frame, { belowY = -Infinity, nonEmpty = false } = {}) {
  const group = frame.locator(textBlockSelector);
  const candidates = [];
  const total = await group.count().catch(() => 0);
  for (let index = 0; index < total; index++) {
    const locator = group.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    const box = visible ? await locator.boundingBox().catch(() => null) : null;
    const disabled = await locator.isDisabled().catch(() => false);
    const contenteditable = await locator.getAttribute("contenteditable").catch(() => null);
    const role = await locator.getAttribute("role").catch(() => null);
    const placeholder = String(await locator.getAttribute("data-placeholder").catch(() => "") || await locator.getAttribute("placeholder").catch(() => "") || "");
    const caption = typeof locator.evaluate === "function" ? await locator.evaluate((element) => {
      const signature = `${element.className || ""} ${element.getAttribute("data-placeholder") || ""} ${element.getAttribute("placeholder") || ""}`;
      return /caption|캡션|설명/i.test(signature) || Boolean(element.closest(".se-component.se-image, [data-module='image']"));
    }).catch(() => false) : false;
    if (!visible || !box || box.width <= 100 || box.height <= 10 || box.y <= belowY || disabled || caption || /캡션|설명/i.test(placeholder)) continue;
    if (contenteditable !== "true" && role !== "textbox") continue;
    const text = String(await locator.textContent().catch(() => "") || "").trim();
    if (nonEmpty && !text) continue;
    candidates.push({ locator, box, text, selector: await describeLocator(locator), caption: false });
  }
  return candidates;
}

async function describeLocator(locator) {
  const className = String(await locator.getAttribute("class").catch(() => "") || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  const role = await locator.getAttribute("role").catch(() => null);
  const editable = await locator.getAttribute("contenteditable").catch(() => null);
  return `${className ? `.${className}` : "element"}${role ? `[role=${role}]` : ""}${editable ? `[contenteditable=${editable}]` : ""}`;
}

export async function textBlockCount(frame) {
  return (await editableTextCandidates(frame)).length;
}

export async function inspectInsertionOptions(frame) {
  const images = frame.locator(imageBlockSelector);
  const count = await images.count().catch(() => 0);
  const last = count ? images.nth(count - 1) : null;
  const box = last ? await last.boundingBox().catch(() => null) : null;
  const following = box ? await editableTextCandidates(frame, { belowY: box.y + box.height - 1 }) : [];
  const buttons = frame.locator([
    '.se-component-add', '.se-insert-menu',
    'button[aria-label*="추가"]', 'button[title*="추가"]',
    'button[aria-label*="문단"]', 'button[title*="문단"]',
    'button[aria-label*="텍스트"]', 'button[title*="텍스트"]',
  ].join(", "));
  let visibleButtons = 0;
  for (let i = 0; i < await buttons.count().catch(() => 0); i++) if (await buttons.nth(i).isVisible().catch(() => false)) visibleButtons++;
  const allEditables = frame.locator('[contenteditable="true"], [role="textbox"]');
  let captionExcluded = 0;
  for (let i = 0; i < await allEditables.count().catch(() => 0); i++) {
    const item = allEditables.nth(i);
    const excluded = typeof item.evaluate === "function" ? await item.evaluate((element) => /caption|캡션|설명/i.test(`${element.className || ""} ${element.getAttribute("data-placeholder") || ""}`) || Boolean(element.closest(".se-component.se-image, [data-module='image']"))).catch(() => false) : false;
    if (excluded) captionExcluded++;
  }
  return { followingCount: following.length, buttonCount: visibleButtons, captionExcluded, canInsertBeforeBody: (await editableTextCandidates(frame)).length > 0 };
}

export async function ensureTextBlockAfterLastImage(editorFrame, { beforeTextCount = 0, timeout = 10000, log = async () => {} } = {}) {
  const images = editorFrame.locator(imageBlockSelector);
  const imageCount = await images.count().catch(() => 0);
  if (!imageCount) throw new PublisherStageError("text_block_creation", "이미지 후 텍스트 블록 생성 실패: 이미지 블록이 없습니다.");
  const lastImage = images.nth(imageCount - 1);
  const imageBox = await lastImage.boundingBox().catch(() => null);
  if (!imageBox) throw new PublisherStageError("text_block_creation", "이미지 후 텍스트 블록 생성 실패: 마지막 이미지 위치를 확인할 수 없습니다.");

  const deadline = Date.now() + timeout;
  const findNewBlock = async () => {
    const candidates = await editableTextCandidates(editorFrame, { belowY: imageBox.y + imageBox.height });
    const grown = (await textBlockCount(editorFrame)) > beforeTextCount;
    return grown && candidates.length ? candidates.at(-1) : null;
  };
  let candidate = await findNewBlock(); // A: real following editable sibling/descendant, excluding captions
  const addButtons = editorFrame.locator('.se-component-add, .se-insert-menu, button[aria-label*="추가"], button[title*="추가"], button[aria-label*="문단"], button[title*="문단"], button[aria-label*="텍스트"], button[title*="텍스트"]');
  if (!candidate) { // B: editor-owned insertion controls
    for (let i = 0; i < await addButtons.count().catch(() => 0) && !candidate; i++) {
      const button = addButtons.nth(i);
      if (await button.isVisible().catch(() => false)) { await button.click().catch(() => {}); candidate = await findNewBlock(); }
    }
  }
  if (!candidate) { await lastImage.click().catch(() => {}); await lastImage.press("Enter").catch(() => {}); candidate = await findNewBlock(); } // C
  if (!candidate) { await lastImage.click().catch(() => {}); await lastImage.press("ArrowDown").catch(() => {}); await lastImage.press("Enter").catch(() => {}); candidate = await findNewBlock(); } // D
  if (!candidate) { // E
    for (const offset of [20, 40, 70]) {
      await editorFrame.page().mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height + offset).catch(() => {});
      candidate = await findNewBlock(); if (candidate) break;
    }
  }
  if (!candidate) { // F: bottom of editor canvas
    const viewport = editorFrame.page().viewportSize?.() || { width: 1200, height: 900 };
    await editorFrame.page().mouse.click(viewport.width / 2, viewport.height - 80).catch(() => {});
    await editorFrame.page().keyboard.press?.("Enter").catch(() => {});
  }
  while (!candidate && Date.now() < deadline) {
    candidate = await findNewBlock();
    if (!candidate) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await log(`새 텍스트 블록 생성 ${candidate ? "성공" : "실패"}`);
  if (!candidate) throw new PublisherStageError("text_block_creation", "이미지 후 텍스트 블록 생성 실패");
  return candidate.locator;
}

export async function findImageControl(frame) {
  const input = frame.locator('input[type="file"]').first();
  if (await input.count().catch(() => 0)) return { input, button: null };
  const found = await firstVisible(frame, editorSelectors.image);
  return { input: null, button: found?.locator || null };
}

export async function uploadSingleImage(page, frame, filePath, { timeout = 20000 } = {}) {
  const before = await imageBlockCount(frame);
  const control = await findImageControl(frame);
  if (control.input) {
    await control.input.setInputFiles(filePath);
  } else {
    if (!control.button) throw new PublisherStageError("image_control", "mainFrame에서 이미지 버튼 또는 file input을 찾지 못했습니다.");
    const chooserPromise = page.waitForEvent("filechooser", { timeout });
    await control.button.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  }
  await frame.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length >= expected,
    { selector: imageBlockSelector, expected: before + 1 }, { timeout });
  return imageBlockCount(frame);
}

async function typeSentence(page, target, sentence, sentenceNumber, log) {
  const text = String(sentence || "").trim();
  if (!text) throw new PublisherStageError("body_input", "빈 본문 문장은 입력할 수 없습니다.");
  const selector = await describeLocator(target);
  await log(`문장 ${sentenceNumber} 입력 대상 selector: ${selector}`);
  try {
    await target.click();
    await target.focus();
    await target.pressSequentially(text, { delay: 5 });
  } catch {
    try { await target.click(); await page.keyboard.insertText(text); }
    catch { await target.press("End"); await page.keyboard.insertText(text); }
  }
  const marker = text.slice(0, Math.min(20, text.length));
  const reflected = String(await target.innerText().catch(() => target.textContent().catch(() => "")) || "").includes(marker);
  await log(`문장 ${sentenceNumber} 입력 후 반영 확인 ${reflected ? "성공" : "실패"}`);
  if (!reflected) throw new PublisherStageError("body_input", `문장 ${sentenceNumber} 입력 반영 실패`);
  await target.press("Enter");
  await target.press("Enter");
  return target;
}

async function nextTextBlock(frame, previous, timeout = 10000) {
  const previousBox = await previous.boundingBox().catch(() => null);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const candidates = await editableTextCandidates(frame, { belowY: previousBox ? previousBox.y : -Infinity });
    if (candidates.length) return candidates.at(-1).locator;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new PublisherStageError("text_block_creation", "이미지 후 텍스트 블록 생성 실패: 다음 문단을 만들지 못했습니다.");
}

async function insertImageFirst({ page, frame, bodyLocator, files, bodyBlocks, upload, onUpload, log, textBlockTimeout }) {
  let sentenceCount = 0;
  let target = bodyLocator;
  for (let index = 0; index < files.length; index++) {
    const beforeTextCount = await textBlockCount(frame);
    await log(`이미지 업로드 전 텍스트 블록 수: ${beforeTextCount}`);
    const count = await upload(page, frame, files[index]);
    await onUpload(index, count);
    await log(`이미지 ${index} 삽입 위치: block${index} 앞 (image-first)`);
    const afterTextCount = await textBlockCount(frame);
    await log(`이미지 업로드 후 텍스트 블록 수: ${afterTextCount}`);
    target = await ensureTextBlockAfterLastImage(frame, { beforeTextCount, timeout: textBlockTimeout, log });
    await typeSentence(page, target, bodyBlocks[index], index + 1, log); sentenceCount++;
  }
  for (let index = files.length; index < bodyBlocks.length; index++) {
    target = await nextTextBlock(frame, target, textBlockTimeout);
    await typeSentence(page, target, bodyBlocks[index], index + 1, log); sentenceCount++;
  }
  return sentenceCount;
}

async function insertTextFirst({ page, frame, bodyLocator, files, bodyBlocks, upload, onUpload, log, textBlockTimeout }) {
  const targets = [];
  let target = bodyLocator;
  for (let index = 0; index < bodyBlocks.length; index++) {
    targets.push(target);
    await typeSentence(page, target, bodyBlocks[index], index + 1, log);
    if (index + 1 < bodyBlocks.length) target = await nextTextBlock(frame, target, textBlockTimeout);
  }
  // Inserting from the last anchor backwards prevents an earlier insertion from invalidating later anchors.
  for (let index = files.length - 1; index >= 0; index--) {
    const anchorIndex = Math.min(index, targets.length - 1);
    const anchor = targets[anchorIndex];
    await anchor.click();
    await anchor.press("Home").catch(() => {});
    const count = await upload(page, frame, files[index]);
    await onUpload(index, count);
    await log(`이미지 ${index} 삽입 위치: block${anchorIndex} 앞 (text-first, 역순)`);
  }
  return bodyBlocks.length;
}

async function removeOnlyInsertedImage(frame, timeout) {
  const images = frame.locator(imageBlockSelector);
  if (await images.count().catch(() => 0) !== 1) return false;
  const image = images.first();
  await image.click().catch(() => {});
  await image.press("Delete").catch(() => image.press("Backspace").catch(() => {}));
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await imageBlockCount(frame) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function insertImageTextSequence({ page, frame, bodyLocator, files, bodyBlocks, upload = uploadSingleImage, onUpload = async () => {}, log = async () => {}, textBlockTimeout = 10000, strategy = "auto" }) {
  const usedFiles = Array.isArray(files) ? files.slice(0, MAX_IMAGE_COUNT) : [];
  if (usedFiles.length < 1 || bodyBlocks.length < MIN_BODY_BLOCKS) throw new PublisherStageError("sequence_validation", "이미지 1장 이상과 본문 문장 7개 이상이 필요합니다.");
  const selectedStrategy = strategy === "image-first" ? "image-first" : "text-first";
  await log(`선택한 입력 전략: ${selectedStrategy}`);
  let sentenceCount;
  try {
    sentenceCount = selectedStrategy === "image-first"
      ? await insertImageFirst({ page, frame, bodyLocator, files: usedFiles, bodyBlocks, upload, onUpload, log, textBlockTimeout })
      : await insertTextFirst({ page, frame, bodyLocator, files: usedFiles, bodyBlocks, upload, onUpload, log, textBlockTimeout });
  } catch (error) {
    let safeToSwitch = selectedStrategy === "image-first" && await imageBlockCount(frame) === 0;
    if (!safeToSwitch && selectedStrategy === "image-first" && usedFiles.length === 1 && error?.stage === "text_block_creation") {
      safeToSwitch = await removeOnlyInsertedImage(frame, textBlockTimeout);
      await log(`image-first 삽입 이미지 원상복구: ${safeToSwitch ? "성공" : "실패"}`);
    }
    if (safeToSwitch) {
      await log("image-first 실패, text-first 전략으로 전환");
      sentenceCount = await insertTextFirst({ page, frame, bodyLocator, files: usedFiles, bodyBlocks, upload, onUpload, log, textBlockTimeout });
      return { sentenceCount, imageCount: usedFiles.length, domImageCount: await imageBlockCount(frame), strategy: "text-first" };
    }
    throw error;
  }
  return { sentenceCount, imageCount: usedFiles.length, domImageCount: await imageBlockCount(frame), strategy: selectedStrategy };
}

export async function verifyDomSequence(frame, bodyBlocks, imageCount) {
  const nodes = frame.locator(`${imageBlockSelector}, .se-component.se-text, .se-text-paragraph`);
  const found = [];
  for (let i = 0; i < await nodes.count().catch(() => 0); i++) {
    const node = nodes.nth(i);
    if (!await node.isVisible().catch(() => false)) continue;
    const isImage = await node.evaluate((element) => element.matches(".se-component.se-image, [data-module='image']")).catch(() => false);
    if (isImage) { found.push(`image${found.filter((item) => item.startsWith("image")).length}`); continue; }
    const text = String(await node.textContent().catch(() => "") || "");
    const blockIndex = bodyBlocks.findIndex((block) => text.includes(String(block).trim().slice(0, 20)));
    if (blockIndex >= 0 && !found.includes(`block${blockIndex}`)) found.push(`block${blockIndex}`);
  }
  const expected = [];
  for (let i = 0; i < bodyBlocks.length; i++) { if (i < imageCount) expected.push(`image${i}`); expected.push(`block${i}`); }
  return { valid: expected.every((item, index) => found[index] === item), found, expected };
}

export async function verifyInsertedSentences(frame, bodyLocator, bodyBlocks) {
  const nonEmptyCandidates = await editableTextCandidates(frame, { nonEmpty: true });
  const paragraphTexts = [];
  for (const selector of [".se-text-paragraph", ".se-component.se-text"]) {
    const group = frame.locator(selector);
    for (let index = 0; index < await group.count().catch(() => 0); index++) {
      const item = group.nth(index);
      if (await item.isVisible().catch(() => false)) paragraphTexts.push(String(await item.textContent().catch(() => "") || "").trim());
    }
  }
  const allText = [...paragraphTexts, ...nonEmptyCandidates.map(({ text }) => text), String(await bodyLocator.textContent().catch(() => "") || "")].join("\n");
  return bodyBlocks.filter((block) => allText.includes(String(block).trim().slice(0, 20))).length;
}

export async function selectCategoryIfPresent({ page, frame, categoryName, dryRun = false, log = async () => {} }) {
  if (!categoryName) return false;
  for (const scope of [frame, page]) {
    if (!scope) continue;
    const button = (await firstVisible(scope, editorSelectors.category))?.locator;
    if (!button) continue;
    if (dryRun) return true;
    try {
      await button.click();
      let option = null;
      for (const optionScope of [frame, page]) {
        const candidate = optionScope?.getByText(categoryName, { exact: true }).first();
        if (candidate && await candidate.isVisible().catch(() => false)) { option = candidate; break; }
      }
      if (!option) continue;
      await option.click();
      await log(`카테고리 선택 완료: ${categoryName}`);
      return true;
    } catch { /* try the next editor scope */ }
  }
  await log("카테고리 선택 생략: 기존 선택 유지");
  return false;
}

export function expectedSequenceLog(imageCount = MAX_IMAGE_COUNT, bodyBlockCount = MIN_BODY_BLOCKS) {
  const usedImageCount = Math.min(Math.max(Number(imageCount) || 0, 0), MAX_IMAGE_COUNT);
  const sequence = [];
  for (let index = 0; index < usedImageCount; index++) sequence.push(`image${index}`, `block${index}`);
  for (let index = usedImageCount; index < bodyBlockCount; index++) sequence.push(`block${index}`);
  return `예상 입력 순서: ${sequence.join(" → ")}`;
}
