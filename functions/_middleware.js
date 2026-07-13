import { bearerToken, tokensMatch } from "./lib/auth.js";

const LOGIN_PATH = "/__site-login";
const COOKIE_NAME = "site_session";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const cookieValue = (request, name) => {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
};

const serviceAuthorized = (request, env) => {
  const token = bearerToken(request);
  return [env.AUTOMATION_TOKEN, env.PUBLISHER_TOKEN]
    .some((expected) => expected && tokensMatch(token, expected));
};

const loginPage = (error = "") => new Response(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>사이트 잠금</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1020; color: #f8fafc; }
    main { width: min(90vw, 380px); padding: 32px; border: 1px solid #26324a; border-radius: 18px; background: #111a2e; box-shadow: 0 24px 70px #0008; }
    h1 { margin: 0 0 10px; font-size: 24px; }
    p { margin: 0 0 22px; color: #aebbd0; line-height: 1.5; }
    label { display: block; margin-bottom: 8px; font-weight: 700; }
    input, button { width: 100%; min-height: 48px; border-radius: 10px; font: inherit; }
    input { padding: 0 14px; border: 1px solid #3a4965; background: #0b1222; color: #fff; }
    button { margin-top: 12px; border: 0; background: #4f7cff; color: #fff; font-weight: 800; cursor: pointer; }
    .error { margin: 12px 0 0; color: #ff9a9a; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>잠긴 사이트입니다</h1>
    <p>계속하려면 비밀번호를 입력하세요.</p>
    <form method="post" action="${LOGIN_PATH}">
      <label for="password">비밀번호</label>
      <input id="password" name="password" type="password" required autofocus autocomplete="current-password">
      <button type="submit">잠금 해제</button>
      ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}
    </form>
  </main>
</body>
</html>`, {
  status: error ? 401 : 200,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  },
});

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const password = env.SITE_PASSWORD;

  if (!password) {
    return new Response("SITE_PASSWORD is not configured", { status: 503 });
  }

  if (url.pathname === LOGIN_PATH) {
    if (request.method !== "POST") return Response.redirect(new URL("/", url), 303);

    const form = await request.formData();
    const provided = String(form.get("password") || "");
    if (!tokensMatch(provided, password)) return loginPage("비밀번호가 올바르지 않습니다.");

    const session = await sha256(password);
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
        "Cache-Control": "no-store",
      },
    });
  }

  const expectedSession = await sha256(password);
  const session = cookieValue(request, COOKIE_NAME);
  if (tokensMatch(session, expectedSession) || serviceAuthorized(request, env)) {
    const response = await context.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "SITE_LOCKED" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return loginPage();
};
