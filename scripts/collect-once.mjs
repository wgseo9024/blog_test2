const baseUrl = process.env.CLOUDFLARE_WORKER_API_URL || process.env.BLOG_API_BASE_URL || "https://blog-test2-k36.pages.dev";
const token = process.env.AUTOMATION_TOKEN || "";
if (!token) {
  console.error("AUTOMATION_TOKEN이 필요합니다. Secret 값은 명령줄 인자가 아닌 환경변수로 설정하세요.");
  process.exit(1);
}
const response = await fetch(new URL("/api/collect", baseUrl), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
const body = await response.json().catch(() => null);
if (!response.ok || !body?.success) {
  console.error(`수집 실패: HTTP ${response.status} ${body?.error?.code || "INVALID_RESPONSE"} ${body?.error?.message || ""}`);
  process.exit(1);
}
const data = body.data;
console.log(JSON.stringify({ runId: data.runId, fetchedCount: data.fetchedCount, newArticleCount: data.newArticleCount,
  duplicateCount: data.duplicateCount, advertisementExcludedCount: data.advertisementExcludedCount,
  shortContentExcludedCount: data.shortContentExcludedCount, extractionSuccessCount: data.extractionSuccessCount,
  groupCount: data.groupCount, draftCount: data.draftCount, imageCandidateCount: data.imageCandidateCount,
  sources: data.sources, generationErrors: data.generationErrors }, null, 2));
