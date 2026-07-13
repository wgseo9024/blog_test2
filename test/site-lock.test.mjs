import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/_middleware.js";

const env = { SITE_PASSWORD: "test-password" };

test("잠긴 페이지는 로그인 화면을 반환한다", async () => {
  const response = await onRequest({
    request: new Request("https://example.com/"),
    env,
    next: () => new Response("private"),
  });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /잠긴 사이트입니다/);
});

test("잘못된 비밀번호는 거부하고 올바른 비밀번호는 세션을 만든다", async () => {
  const badResponse = await onRequest({
    request: new Request("https://example.com/__site-login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
    }),
    env,
  });
  assert.equal(badResponse.status, 401);

  const loginResponse = await onRequest({
    request: new Request("https://example.com/__site-login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=test-password",
    }),
    env,
  });
  assert.equal(loginResponse.status, 303);
  assert.match(loginResponse.headers.get("Set-Cookie"), /^site_session=.*HttpOnly.*Secure/);

  const cookie = loginResponse.headers.get("Set-Cookie").split(";", 1)[0];
  const unlockedResponse = await onRequest({
    request: new Request("https://example.com/", { headers: { Cookie: cookie } }),
    env,
    next: () => new Response("private"),
  });
  assert.equal(await unlockedResponse.text(), "private");
});

test("로그인하지 않은 API 요청은 차단한다", async () => {
  const response = await onRequest({
    request: new Request("https://example.com/api/articles"),
    env,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "SITE_LOCKED" });
});
