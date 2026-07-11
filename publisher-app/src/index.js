import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = path.join(appDir, ".session", "naver-profile");
const artifactDir = path.join(appDir, "artifacts");
const logDir = path.join(appDir, "logs");
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

async function saveFailureArtifacts(page, prefix) {
  const id = stamp();
  const screenshot = path.join(artifactDir, `${prefix}-${id}.png`);
  const htmlPath = path.join(artifactDir, `${prefix}-${id}.html`);
  try { await page.screenshot({ path: screenshot, fullPage: true }); } catch { /* browser may be unavailable */ }
  try {
    const html = await page.evaluate(() => {
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll("script,style").forEach((node) => node.remove());
      copy.querySelectorAll("input,textarea").forEach((node) => { node.value = ""; node.removeAttribute("value"); });
      return copy.outerHTML.slice(0, 100000);
    });
    await writeFile(htmlPath, html, "utf8");
  } catch { /* page may be closed */ }
  await log(`진단 파일 저장: ${screenshot}, ${htmlPath}`, "error");
}

const titleSelectors = [
  '[contenteditable="true"][data-placeholder*="제목"]',
  '.se-title-text [contenteditable="true"]',
  '.se-title-text',
];
const bodySelectors = [
  '.se-component-content [contenteditable="true"]',
  '[contenteditable="true"][data-placeholder*="본문"]',
  '.se-text-paragraph',
];

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return { locator, selector };
  }
  return null;
}

async function inspectEditor(page) {
  await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  await stopWarning(page);
  const title = await firstVisible(page, titleSelectors);
  const body = await firstVisible(page, bodySelectors);
  await log(`제목 필드: ${title ? `성공 (${title.selector})` : "실패"}`);
  await log(`본문 필드: ${body ? `성공 (${body.selector})` : "실패"}`);
  if (!title || !body) throw new Error("네이버 글쓰기 입력 필드를 안전하게 확인하지 못했습니다.");
  return { title, body };
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
  await waitForLogin(page);

  if (mode === "dry-run") {
    try { await inspectEditor(page); await log("Dry Run 성공: 입력이나 저장, 발행은 수행하지 않았습니다."); }
    catch (error) { await saveFailureArtifacts(page, "dry-run-failed"); throw error; }
    await context.close();
    process.exit(0);
  }

  if (mode === "publish") {
    if (!args.has("--publish") || process.env.PUBLISH_CONFIRM !== "YES") {
      throw new Error("공개 발행 보호 조건이 충족되지 않았습니다. 아무 작업도 수행하지 않습니다.");
    }
  } else {
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
  try {
    const editor = await inspectEditor(page);
    await editor.title.locator.fill(draft.title);
    await editor.body.locator.fill(`${draft.content}\n\n${(draft.tags || []).map((tag) => `#${tag}`).join(" ")}`.trim());
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
      const saveButton = page.getByRole("button", { name: /임시저장/ }).first();
      if (!await saveButton.isVisible().catch(() => false)) throw new Error("임시저장 버튼을 확인하지 못했습니다.");
      await saveButton.click({ timeout: 10000 });
      const confirmation = page.getByText(/임시저장.*(완료|저장)|저장되었습니다/i).first();
      const messageVisible = await confirmation.isVisible({ timeout: 10000 }).catch(() => false);
      const buttonUsable = await saveButton.isEnabled().catch(() => false);
      if (!messageVisible || !buttonUsable) throw new Error("두 가지 신호로 임시저장 성공을 확인하지 못했습니다.");
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: "released", message: "네이버 임시저장 완료" }) });
      resultSent = true;
      await log(`초안 #${draft.id} 임시저장 성공을 기록했습니다. 공개 발행은 하지 않았습니다.`);
      const rl = createInterface({ input, output });
      await rl.question("브라우저에서 임시저장 글을 확인한 뒤 Enter를 누르세요: ");
      rl.close();
    }
  } catch (error) {
    await saveFailureArtifacts(page, mode === "publish" ? "publish-failed" : "save-draft-failed");
    if (!resultSent) {
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: "failed", message: String(error.message).slice(0, 500) }) }).catch(() => {});
    }
    throw error;
  }
  await context.close();
} catch (error) {
  await log(`[중단] ${error.message}`, "error");
  process.exitCode = 1;
  await context?.close().catch(() => {});
}
