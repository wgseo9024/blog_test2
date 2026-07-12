import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { editorSelectors, firstVisible } from "./naver-selectors.js";

export const MAX_IMAGE_COUNT = 4;
export const MIN_BODY_BLOCKS = 7;
export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
export const imageBlockSelector = ".se-component.se-image, .se-image-resource, [data-module=\"image\"]";

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
      const filePath = path.join(directory, `image-${index + 1}${extension}`);
      await writeFile(filePath, buffer);
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

async function currentTextBlock(frame, fallback) {
  const paragraphs = frame?.locator?.(".se-text-paragraph");
  if (paragraphs?.last) {
    const latest = paragraphs.last();
    if (await latest.isVisible().catch(() => false)) return latest;
  }
  return fallback;
}

async function typeSentence(frame, bodyLocator, sentence) {
  const text = String(sentence || "").trim();
  if (!text) throw new PublisherStageError("body_input", "빈 본문 문장은 입력할 수 없습니다.");
  const target = await currentTextBlock(frame, bodyLocator);
  await target.click();
  await target.press("End");
  await target.pressSequentially(text);
  await target.press("Enter");
  await target.press("Enter");
}

export async function insertImageTextSequence({ page, frame, bodyLocator, files, bodyBlocks, upload = uploadSingleImage, onUpload = async () => {} }) {
  const usedFiles = Array.isArray(files) ? files.slice(0, MAX_IMAGE_COUNT) : [];
  if (usedFiles.length < 1 || bodyBlocks.length < MIN_BODY_BLOCKS) throw new PublisherStageError("sequence_validation", "이미지 1장 이상과 본문 문장 7개 이상이 필요합니다.");
  let sentenceCount = 0;
  for (let index = 0; index < usedFiles.length; index++) {
    const count = await upload(page, frame, usedFiles[index]);
    await onUpload(index, count);
    await typeSentence(frame, bodyLocator, bodyBlocks[index]);
    sentenceCount++;
  }
  for (let index = usedFiles.length; index < bodyBlocks.length; index++) {
    await typeSentence(frame, bodyLocator, bodyBlocks[index]);
    sentenceCount++;
  }
  return { sentenceCount, imageCount: usedFiles.length, domImageCount: await imageBlockCount(frame) };
}

export async function verifyInsertedSentences(frame, bodyLocator, bodyBlocks) {
  const container = frame?.locator?.(".se-main-container");
  const actualText = container && await container.count().catch(() => 0) ? await container.first().innerText() : await bodyLocator.innerText();
  const count = bodyBlocks.filter((block) => actualText.includes(String(block).trim())).length;
  return count;
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
