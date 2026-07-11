import { failure } from "../../lib/automation.js";
import { executeAutomation } from "./run.js";

const tokensMatch = (provided, expected) => {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
};

export async function onRequestPost({ request, env }) {
  if (!env.MANUAL_AUTOMATION_TOKEN) {
    console.error("MANUAL_AUTOMATION_TOKEN is not configured");
    return failure("수동 실행 인증이 설정되지 않았습니다.", 503);
  }

  const provided = request.headers.get("X-Manual-Automation-Token") || "";
  if (!tokensMatch(provided, env.MANUAL_AUTOMATION_TOKEN)) {
    return failure("수동 실행 권한이 없습니다.", 401);
  }
  return executeAutomation({ env, triggerType: "manual" });
}

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return failure("POST 요청만 허용됩니다.", 405, { Allow: "POST" });
  }
  return onRequestPost(context);
}
