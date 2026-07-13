import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dismissExistingDraftPopup, editorSelectors, findEditorAcrossFrames, firstVisible, waitForMainFrame } from "./naver-selectors.js";
import { cleanupDraftImages, downloadApprovedImages, expectedSequenceLog, findImageControl, insertImageTextSequence, inspectInsertionOptions, PublisherStageError, selectCategoryIfPresent, textBlockCount, validateDraftAssets, verifyDomSequence, verifyInsertedSentences } from "./publisher-workflow.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = path.join(appDir, ".session", "naver-profile");
const artifactDir = path.join(appDir, "artifacts");
const logDir = path.join(appDir, "logs");
const tmpRoot = path.join(appDir, "tmp");
await Promise.all([profileDir, artifactDir, logDir].map((dir) => mkdir(dir, { recursive: true })));

async function loadLocalEnv() {
  let text;
  try { text = await readFile(path.join(appDir, ".env"), "utf8"); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
await loadLocalEnv();

const args = new Set(process.argv.slice(2));
const mode = args.has("--login-check") ? "login" : args.has("--dry-run") ? "dry-run" : args.has("--publish") ? "publish" : "save-draft";
const baseUrl = process.env.BLOG_API_BASE_URL || "https://blog-test2-k36.pages.dev";
const token = process.env.PUBLISHER_TOKEN || "";
const writeUrl = process.env.NAVER_BLOG_WRITE_URL || "https://blog.naver.com/GoBlogWrite.naver";
const headless = String(process.env.HEADLESS || "false").toLowerCase() === "true";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(logDir, `publisher-${stamp()}.log`);
const categoryName = process.env.NAVER_BLOG_CATEGORY || "";
const unattended = process.env.AUTO_SAVE_DRAFT === "YES";

async function log(message, level = "info") {
  const safe = String(message).replaceAll(token, token ? "[REDACTED]" : "");
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${safe}`;
  await writeFile(logPath, `${line}\n`, { flag: "a" });
  (level === "error" ? console.error : console.log)(safe);
}

const api = async (apiPath, options = {}) => {
  if (!token) throw new Error("PUBLISHER_TOKEN이 설정되지 않았습니다. .env 파일에 직접 입력하세요.");
  const response = await fetch(new URL(apiPath, baseUrl), { ...options, headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}),
  } });
  let body;
  try { body = await response.json(); } catch { throw new Error(`API 응답을 읽지 못했습니다 (HTTP ${response.status}).`); }
  if (!response.ok || body.success === false) throw new Error(body.error?.message || `API HTTP ${response.status}`);
  return body.data;
};

async function selectCategory(page, frame, dryRun = false) {
  return selectCategoryIfPresent({ page, frame, categoryName, dryRun, log });
}

async function visibleAcross(page, frame, candidates) {
  for (const scope of [frame, page]) {
    const found = scope ? await firstVisible(scope, candidates) : null;
    if (found) return found;
  }
  return null;
}

async function queuedDrafts() {
  const queue = await api("/api/publisher/queued");
  if (!Array.isArray(queue?.drafts)) throw new Error("발행 대기열 API 응답 형식이 올바르지 않습니다.");
  if (!queue.drafts.length) await log("발행 대기 초안이 없습니다. 정상 종료합니다.");
  else await log(`대기 초안: #${queue.drafts[0].id} | ${queue.drafts[0].title} | ${queue.drafts[0].status}`);
  return queue.drafts;
}

const loginSignals = async (page) => {
  const urlSignal = !/nid\.naver\.com\/.*login|nidlogin/i.test(page.url());
  const loginButtonVisible = await page.locator('a[href*="nidlogin"], a[href*="nid.naver.com/nidlogin"], #account a[href*="login"]').first().isVisible().catch(() => false);
  const userMenuVisible = await page.locator('a[href*="logout"], [class*="profile"], [aria-label*="프로필"], [class*="MyView"]').first().isVisible().catch(() => false);
  return { urlSignal, noLoginButton: !loginButtonVisible, userMenuVisible,
    passed: urlSignal && !loginButtonVisible && userMenuVisible };
};

const stopWarning = async (page) => {
  const warning = page.getByText(/캡차|자동입력 방지|비정상적인 접근|2단계 인증|다시 로그인/i).first();
  if (await warning.isVisible().catch(() => false)) throw new Error("캡차, 재로그인, 2단계 인증 또는 비정상 접근 경고가 감지되었습니다.");
};

async function sanitizedHtml(scope) {
  return scope.evaluate(() => {
    const copy = document.documentElement.cloneNode(true);
    copy.querySelectorAll("script,style").forEach((node) => node.remove());
    copy.querySelectorAll("input,textarea").forEach((node) => { node.value = ""; node.removeAttribute("value"); });
    copy.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        if (/token|cookie|authorization|session|email|phone|name/i.test(attribute.name)) node.removeAttribute(attribute.name);
        else if (/^(href|src|action)$/i.test(attribute.name)) {
          try { const url = new URL(attribute.value, location.origin); url.search = ""; url.hash = ""; node.setAttribute(attribute.name, url.href); }
          catch { node.removeAttribute(attribute.name); }
        }
      }
    });
    copy.querySelectorAll('[contenteditable="true"]').forEach((node) => {
      const text = String(node.textContent || "").trim();
      node.textContent = text ? `${text.slice(0, 20)}${text.length > 20 ? "…[MASKED]" : ""}` : "";
    });
    return copy.outerHTML.slice(0, 100000);
  });
}

async function saveFailureArtifacts(page, prefix) {
  const id = stamp();
  const screenshot = path.join(artifactDir, `${prefix}-${id}.png`);
  const outerHtmlPath = path.join(artifactDir, `${prefix}-${id}-outer.html`);
  const mainFrameHtmlPath = path.join(artifactDir, `${prefix}-${id}-mainFrame.html`);
  try { await page.screenshot({ path: screenshot, fullPage: true }); } catch { /* browser may be unavailable */ }
  try { await writeFile(outerHtmlPath, await sanitizedHtml(page), "utf8"); } catch { /* page may be closed */ }
  const mainFrame = page.frame({ name: "mainFrame" });
  try { if (mainFrame) await writeFile(mainFrameHtmlPath, await sanitizedHtml(mainFrame), "utf8"); } catch { /* frame may be detached */ }
  await log(`진단 파일 저장: ${screenshot}, ${outerHtmlPath}${mainFrame ? `, ${mainFrameHtmlPath}` : ""}`, "error");
}

async function inspectEditor(page) {
  await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  await stopWarning(page);
  const popupHandled = await dismissExistingDraftPopup(page);
  await log(`기존 작성글 팝업 처리: ${popupHandled}`);
  if (!popupHandled) throw new Error("기존 작성글 확인 팝업을 닫지 못했습니다.");
  const main = await waitForMainFrame(page, 15000);
  await log(`mainFrame 발견: ${main.found}`);
  await log(`mainFrame URL 확인: ${main.urlConfirmed}`);
  const editor = await findEditorAcrossFrames(page, main.frame, async (frame) => {
    let safeUrl = frame.url;
    try {
      const parsed = new URL(frame.url);
      parsed.search = "";
      parsed.hash = "";
      safeUrl = parsed.href;
    } catch { /* about:blank and malformed URLs contain no useful credentials */ }
    await log(`프레임: name=${JSON.stringify(frame.name)} url=${JSON.stringify(safeUrl)}`);
  });
  const counts = editor.mainResult || editor;
  await log(`제목 후보 개수: ${counts.titleCount}`);
  await log(`본문 후보 개수: ${counts.bodyCount}`);
  const { title, body } = editor;
  await log(`제목 필드: ${title ? `성공 (${title.selector})` : "실패"}`);
  await log(`본문 필드: ${body ? `성공 (${body.selector})` : "실패"}`);
  if (!title || !body) throw new Error("네이버 글쓰기 입력 필드를 안전하게 확인하지 못했습니다.");
  return { title, body, frame: editor.frame };
}

async function replaceFieldValue(locator, value) {
  try { await locator.fill(value); return; } catch { /* contenteditable can reject fill */ }
  await locator.click();
  await locator.press("Control+A");
  await locator.press("Backspace");
  try { await locator.pressSequentially(value); } catch { await locator.evaluate((element, text) => {
    element.focus();
    document.execCommand("insertText", false, text);
  }, value); }
}

async function waitForLogin(page) {
  await page.goto("https://blog.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  let signals = await loginSignals(page);
  if (!signals.passed) {
    await log("열린 브라우저에서 네이버 로그인과 2단계 인증을 직접 완료하세요.");
    const rl = createInterface({ input, output });
    await rl.question("로그인을 마쳤으면 Enter를 누르세요: ");
    rl.close();
    await page.goto("https://blog.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    signals = await loginSignals(page);
  }
  if (!signals.passed) throw new Error("두 가지 이상의 신호로 로그인 완료를 확인하지 못했습니다.");
  return signals;
}

let context;
let page;
try {
  context = await chromium.launchPersistentContext(profileDir, { headless, viewport: { width: 1440, height: 1000 } });
  page = context.pages()[0] || await context.newPage();

  if (mode === "login") {
    try { await waitForLogin(page); } catch (error) { await saveFailureArtifacts(page, "login-failed"); throw error; }
    await log("로그인 세션 저장 완료");
    await context.close();
    process.exit(0);
  }

  await log(token ? "PUBLISHER_TOKEN 설정 여부: 있음" : "PUBLISHER_TOKEN 설정 여부: 없음");
  const drafts = await queuedDrafts();
  if (!drafts.length) { await context.close(); process.exit(0); }
  if (mode === "dry-run") {
    await waitForLogin(page);
    try {
      const candidate = drafts[0];
      const approvedImageCount = Array.isArray(candidate.images) ? candidate.images.length : 0;
      const usedImageCount = Math.min(approvedImageCount, 4);
      const bodyBlockCount = Array.isArray(candidate.body_blocks) ? candidate.body_blocks.length : 0;
      await log(`승인 이미지 수: ${approvedImageCount}`);
      await log(`실제 사용할 이미지 수: ${usedImageCount}`);
      await log(`본문 블록 수: ${bodyBlockCount}`);
      await log(expectedSequenceLog(usedImageCount, bodyBlockCount));
      const { bodyBlocks, images } = validateDraftAssets(candidate);
      await log(images.length < 4 ? `승인 이미지 ${images.length}장으로 진행합니다.` : "승인 이미지 중 앞의 4장을 사용합니다.");
      const editor = await inspectEditor(page);
      const imageControl = await findImageControl(editor.frame);
      if (!imageControl.input && !imageControl.button) throw new PublisherStageError("dry_run_image_control", "mainFrame에서 이미지 버튼 또는 file input을 찾지 못했습니다.");
      const dryRunTextBlocks = await textBlockCount(editor.frame);
      await log(`이미지 아래 새 텍스트 블록 생성 가능성: ${dryRunTextBlocks > 0 ? "있음" : "편집 가능한 본문 selector 기반 확인"}`);
      const insertion = await inspectInsertionOptions(editor.frame);
      await log(`입력 전략: ${insertion.canInsertBeforeBody ? "text-first" : "image-first"}`);
      await log(`이미지 다음 sibling 후보 수: ${insertion.followingCount}`);
      await log(`새 문단 버튼 후보 수: ${insertion.buttonCount}`);
      await log(`캡션 후보 제외 수: ${insertion.captionExcluded}`);
      await log(`본문 앞 이미지 삽입 가능 여부: ${insertion.canInsertBeforeBody ? "가능" : "확인 불가"}`);
      if (!await visibleAcross(page, editor.frame, editorSelectors.temporarySave)) throw new PublisherStageError("dry_run_save_control", "임시저장 버튼을 찾지 못했습니다.");
      await selectCategory(page, editor.frame, true);
      await log("Dry Run 성공: 다운로드, 업로드, 입력, 임시저장은 수행하지 않았습니다.");
    }
    catch (error) { await saveFailureArtifacts(page, "dry-run-failed"); throw error; }
    await context.close();
    process.exit(0);
  }

  if (mode === "publish") {
    if (!args.has("--publish") || process.env.PUBLISH_CONFIRM !== "YES") {
      throw new Error("공개 발행 보호 조건이 충족되지 않았습니다. 아무 작업도 수행하지 않습니다.");
    }
  } else if (!unattended) {
    const rl = createInterface({ input, output });
    const answer = await rl.question('계속하려면 정확히 "임시저장 테스트 진행"을 입력하세요: ');
    rl.close();
    if (answer !== "임시저장 테스트 진행") throw new Error("임시저장 테스트 승인이 없어 종료합니다.");
  }

  const requestedId = Number([...args].find((arg) => arg.startsWith("--draft="))?.split("=")[1]);
  const candidate = drafts.find((draft) => draft.id === requestedId) || drafts[0];
  const lease = await api("/api/publisher/lease", { method: "POST", body: JSON.stringify({ draft_id: candidate.id }) });
  const draft = lease.draft;
  let resultSent = false;
  let temporaryDirectory = null;
  try {
    await page.goto("https://blog.naver.com/",{waitUntil:"domcontentloaded",timeout:30000});
    const signals=await loginSignals(page);if(!signals.passed){await api("/api/publisher/result",{method:"POST",body:JSON.stringify({draft_id:draft.id,lease_token:lease.lease_token,result:"login_required",message:"로그인이 만료되었습니다. npm run login-check로 재로그인하세요."})});resultSent=true;throw new Error("LOGIN_REQUIRED: npm run login-check로 직접 재로그인하세요.");}
    const { bodyBlocks, images } = validateDraftAssets(draft);
    await log(`승인 이미지 수: ${draft.images?.length || 0}`);
    await log(`실제 사용할 이미지 수: ${images.length}`);
    await log(images.length < 4 ? `승인 이미지 ${images.length}장으로 진행합니다.` : "승인 이미지 중 앞의 4장을 사용합니다.");
    const editor = await inspectEditor(page);
    const downloaded = await downloadApprovedImages(draft, { baseUrl, token, tmpRoot });
    temporaryDirectory = downloaded.directory;
    await replaceFieldValue(editor.title.locator, "");
    await replaceFieldValue(editor.body.locator, "");
    const inserted = await insertImageTextSequence({ page, frame: editor.frame, bodyLocator: editor.body.locator,
      files: downloaded.files, bodyBlocks, strategy: "image-first", log,
      onUpload: async (index, count) => log(`이미지 ${index + 1} 업로드 성공, 현재 이미지 블록 ${count}개`) });
    await replaceFieldValue(editor.title.locator, draft.title);
    const domSentenceCount = await verifyInsertedSentences(editor.frame, editor.body.locator, bodyBlocks);
    const sequence = await verifyDomSequence(editor.frame, bodyBlocks, images.length);
    await log(`선택한 입력 전략: ${inserted.strategy}`);
    await log(`최종 DOM 순서: ${sequence.found.join(" → ")}`);
    await log(`최종 확인된 이미지 개수: ${inserted.domImageCount}`);
    await log(`최종 확인된 문장 개수: ${domSentenceCount}`);
    if (inserted.domImageCount < images.length || domSentenceCount !== bodyBlocks.length || !sequence.valid) throw new PublisherStageError("dom_order_verification", `입력 순서 검증 실패: 이미지 ${inserted.domImageCount}개, 문장 ${domSentenceCount}개, 순서 ${sequence.found.join(" → ")}`);
    await editor.body.locator.pressSequentially((draft.tags||[]).map((tag)=>`#${tag}`).join(" "));
    await selectCategory(page, editor.frame);
    await stopWarning(page);

    if (mode === "publish") {
      await log(`발행 직전 확인: 초안 #${draft.id} | ${draft.title} | 태그 ${(draft.tags || []).length}개 | 공개 발행: 예`);
      const rl = createInterface({ input, output });
      const answer = await rl.question('공개 발행하려면 정확히 "공개 발행합니다"를 입력하세요: ');
      rl.close();
      if (answer !== "공개 발행합니다") throw new Error("마지막 공개 발행 승인이 없어 중단합니다.");
      await stopWarning(page);
      const publishButton = page.getByRole("button", { name: /^발행$|발행하기/ }).last();
      if (!await publishButton.isVisible().catch(() => false)) throw new Error("공개 발행 버튼을 확인하지 못했습니다.");
      await publishButton.click({ timeout: 10000 });
      await page.waitForURL((url) => !/GoBlogWrite\.naver/i.test(url.href), { timeout: 20000 });
      await stopWarning(page);
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: "published", message: "publisher-app 공개 발행 완료" }) });
      resultSent = true;
      await log(`초안 #${draft.id} 공개 발행 성공을 기록했습니다.`);
    } else {
      const saveButton = (await visibleAcross(page, editor.frame, editorSelectors.temporarySave))?.locator;
      if (!saveButton || !await saveButton.isVisible().catch(() => false)) throw new Error("임시저장 버튼을 확인하지 못했습니다.");
      await saveButton.click({ timeout: 10000 });
      const confirmation = page.getByText(/임시저장.*(완료|저장)|저장되었습니다/i).first();
      const messageVisible = await confirmation.isVisible({ timeout: 10000 }).catch(() => false);
      const buttonUsable = await saveButton.isEnabled().catch(() => false);
      if (!messageVisible || !buttonUsable) throw new Error("두 가지 신호로 임시저장 성공을 확인하지 못했습니다.");
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: "released", message: "네이버 임시저장 완료",result_url:page.url() }) });
      resultSent = true;
      await log(`초안 #${draft.id} 임시저장 성공을 기록했습니다. 공개 발행은 하지 않았습니다.`);
      if(!unattended){const rl=createInterface({input,output});await rl.question("브라우저에서 임시저장 글을 확인한 뒤 Enter를 누르세요: ");rl.close();}
    }
  } catch (error) {
    await saveFailureArtifacts(page, mode === "publish" ? "publish-failed" : "save-draft-failed");
    if (!resultSent) {
      const stage = error.stage || "publisher_input";
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: error.result || "retry", message: `${stage}: ${error.message}`.slice(0, 500) }) }).catch(() => {});
    }
    throw error;
  } finally {
    await cleanupDraftImages(temporaryDirectory).catch(() => {});
  }
  await context.close();
} catch (error) {
  await log(`[중단] ${error.message}`, "error");
  process.exitCode = 1;
  await context?.close().catch(() => {});
}
