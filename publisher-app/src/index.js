import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const args = new Set(process.argv.slice(2));
const publish = args.has("--publish");
const loginOnly = args.has("--login-check");
const baseUrl = process.env.BLOG_API_BASE_URL || "http://localhost:8788";
const token = process.env.PUBLISHER_TOKEN || "";
const profileDir = new URL("../.session", import.meta.url).pathname;
const artifactDir = new URL("../artifacts", import.meta.url).pathname;
await mkdir(artifactDir, { recursive: true });

const api = async (path, options = {}) => {
  if (!token) throw new Error("PUBLISHER_TOKEN을 로컬 환경에 설정하세요.");
  const response = await fetch(new URL(path, baseUrl), { ...options, headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}),
  } });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error?.message || `API HTTP ${response.status}`);
  return body.data;
};

const context = await chromium.launchPersistentContext(profileDir, { headless: false, channel: "chrome",
  viewport: { width: 1440, height: 1000 } });
const page = context.pages()[0] || await context.newPage();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = async (error) => {
  const path = `${artifactDir}/failure-${stamp()}.png`;
  try { await page.screenshot({ path, fullPage: true }); } catch { /* browser may already be closed */ }
  console.error(`[중단] ${error.message}\n스크린샷: ${path}`);
  process.exitCode = 1;
};

try {
  await page.goto("https://blog.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  const loggedIn = await page.locator('a[href*="logout"], [class*="profile"], [aria-label*="프로필"]').first()
    .isVisible({ timeout: 5000 }).catch(() => false);
  console.log(loggedIn ? "네이버 로그인 상태를 확인했습니다." : "로그인이 필요합니다. 열린 Chrome에서 직접 로그인하세요.");
  if (loginOnly || !loggedIn) {
    const rl = createInterface({ input, output });
    await rl.question("확인을 마쳤으면 Enter를 누르세요. "); rl.close();
    if (loginOnly) { await context.close(); process.exit(0); }
  }

  const queue = await api("/api/publisher/queued");
  if (!queue.drafts.length) { console.log("발행 대기 초안이 없습니다."); await context.close(); process.exit(0); }
  const requestedId = Number([...args].find((arg) => arg.startsWith("--draft="))?.split("=")[1]);
  const candidate = queue.drafts.find((draft) => draft.id === requestedId) || queue.drafts[0];
  const lease = await api("/api/publisher/lease", { method: "POST", body: JSON.stringify({ draft_id: candidate.id }) });
  const draft = lease.draft;

  try {
    await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    const title = page.locator('[contenteditable="true"][data-placeholder*="제목"], .se-title-text [contenteditable="true"]').first();
    const body = page.locator('.se-component-content [contenteditable="true"], [contenteditable="true"][data-placeholder*="본문"]').last();
    await title.waitFor({ state: "visible", timeout: 15000 });
    await title.fill(draft.title);
    await body.waitFor({ state: "visible", timeout: 15000 });
    await body.fill(`${draft.content}\n\n${draft.tags.map((tag) => `#${tag}`).join(" ")}`);

    if (publish) {
      const rl = createInterface({ input, output });
      const answer = await rl.question(`초안 #${draft.id}를 실제 공개 발행합니다. 정확히 PUBLISH를 입력하세요: `); rl.close();
      if (answer !== "PUBLISH") throw new Error("실제 발행 확인이 취소되었습니다.");
      const publishButton = page.getByRole("button", { name: /발행/ }).last();
      await publishButton.click({ timeout: 10000 });
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: "published", message: "publisher-app 공개 발행 완료" }) });
      console.log(`초안 #${draft.id} 발행 결과를 기록했습니다.`);
    } else {
      const saveButton = page.getByRole("button", { name: /임시저장/ }).first();
      await saveButton.click({ timeout: 10000 });
      await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
        lease_token: lease.lease_token, result: "released", message: "네이버 임시저장 완료" }) });
      console.log(`초안 #${draft.id}를 임시저장했습니다. 공개 발행은 하지 않았습니다.`);
    }
  } catch (error) {
    await api("/api/publisher/result", { method: "POST", body: JSON.stringify({ draft_id: draft.id,
      lease_token: lease.lease_token, result: "failed", message: error.message }) }).catch(() => {});
    throw error;
  }
  await context.close();
} catch (error) {
  await fail(error);
  await context.close().catch(() => {});
}
