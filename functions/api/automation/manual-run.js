import { failure } from "../../lib/automation.js";
import { executeAutomation } from "./run.js";

export async function onRequestPost({ env }) {
  return executeAutomation({ env, triggerType: "manual" });
}

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return failure("POST 요청만 허용됩니다.", 405, { Allow: "POST" });
  }
  return onRequestPost(context);
}
