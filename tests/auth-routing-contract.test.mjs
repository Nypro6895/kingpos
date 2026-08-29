import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  PERSONAL_HOME_PATH,
  getAuthRouteWorkspaceKind,
  loginHrefForReturnPath,
  resolvePostAuthRoute,
  sanitizeAuthReturnPath,
} from "../lib/auth-routing.ts";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const personal = { id: "personal", salonMode: null, type: "personal" };
const account = { id: "account:alpha", salonMode: null, type: "account" };
const owner = { id: "manage:salon-a", salonMode: "manage", type: "salon" };
const staff = { id: "staff:salon-a", salonMode: "staff", type: "salon" };

test("auth return paths are internal relative paths only", () => {
  assert.equal(sanitizeAuthReturnPath(null), PERSONAL_HOME_PATH);
  assert.equal(sanitizeAuthReturnPath(""), PERSONAL_HOME_PATH);
  assert.equal(sanitizeAuthReturnPath("https://evil.example/pos"), PERSONAL_HOME_PATH);
  assert.equal(sanitizeAuthReturnPath("//evil.example/pos"), PERSONAL_HOME_PATH);
  assert.equal(sanitizeAuthReturnPath("/login?next=/pos"), PERSONAL_HOME_PATH);
  assert.equal(sanitizeAuthReturnPath("/pos?ticket=1#pay"), "/pos?ticket=1#pay");
});

test("login return hrefs encode sanitized internal paths", () => {
  assert.equal(loginHrefForReturnPath("/pos"), "/login?next=%2Fpos");
  assert.equal(loginHrefForReturnPath("//evil.example/pos"), "/login?next=%2Fexplore");
});

test("server auth only trusts app-owned session cookies", () => {
  const server = read("lib/supabase/server.ts");
  const logoutRoute = read("app/(app)/api/auth/logout/route.ts");
  const accessTokenFunction = server.slice(
    server.indexOf("export async function getAccessTokenFromRequest"),
    server.indexOf("export async function getSupabaseSessionTokensFromRequest"),
  );
  const sessionTokensFunction = server.slice(
    server.indexOf("export async function getSupabaseSessionTokensFromRequest"),
    server.indexOf("export async function setSupabaseSessionCookies"),
  );

  assert.match(accessTokenFunction, /ACCESS_TOKEN_COOKIE/);
  assert.doesNotMatch(accessTokenFunction, /auth-token|readTokenFromCookieValue|cookieStore\.getAll/);
  assert.match(sessionTokensFunction, /ACCESS_TOKEN_COOKIE/);
  assert.match(sessionTokensFunction, /REFRESH_TOKEN_COOKIE/);
  assert.doesNotMatch(sessionTokensFunction, /auth-token|readSessionFromCookieValue|cookieStore\.getAll/);
  assert.match(server, /isSupabaseAuthTokenCookieName/);
  assert.match(server, /clearSupabaseSessionCookieWriter/);
  assert.match(logoutRoute, /clearSupabaseSessionCookieWriter\(\s*response\.cookies/);
  assert.match(logoutRoute, /cookieStore\.getAll\(\)\.map/);
});

test("credential auth forms post natively and routes keep JSON fetch behavior", () => {
  const loginForm = read("app/login/login-form.tsx");
  const signupForm = read("app/signup/signup-form.tsx");
  const loginRoute = read("app/(app)/api/auth/login/route.ts");
  const signupRoute = read("app/(app)/api/auth/signup/route.ts");

  assert.match(loginForm, /action="\/api\/auth\/login"/);
  assert.match(loginForm, /method="post"/);
  assert.match(loginForm, /Accept: "application\/json"/);
  assert.match(signupForm, /action="\/api\/auth\/signup"/);
  assert.match(signupForm, /method="post"/);
  assert.match(signupForm, /Accept: "application\/json"/);

  assert.match(loginRoute, /function wantsJsonResponse\(request: Request\)/);
  assert.match(loginRoute, /function loginErrorResponse/);
  assert.match(loginRoute, /NextResponse\.redirect\(new URL\(path, request\.url\), 303\)/);
  assert.match(signupRoute, /function wantsJsonResponse\(request: Request\)/);
  assert.match(signupRoute, /function signupErrorResponse/);
  assert.match(signupRoute, /NextResponse\.redirect\(new URL\(path, request\.url\), 303\)/);
});

test("auth route classifier separates account, personal, owner, staff, salon, shared, and neutral routes", () => {
  assert.equal(getAuthRouteWorkspaceKind("/explore"), "shared");
  assert.equal(getAuthRouteWorkspaceKind("/settings"), "shared");
  assert.equal(getAuthRouteWorkspaceKind("/activity"), "personal");
  assert.equal(getAuthRouteWorkspaceKind("/roles"), "account");
  assert.equal(getAuthRouteWorkspaceKind("/pos"), "manage");
  assert.equal(getAuthRouteWorkspaceKind("/staff/today"), "manage");
  assert.equal(getAuthRouteWorkspaceKind("/staff/my-work"), "staff");
  assert.equal(getAuthRouteWorkspaceKind("/staff/connections"), "personal");
  assert.equal(getAuthRouteWorkspaceKind("/salon-profile"), "salon");
  assert.equal(getAuthRouteWorkspaceKind("/book/salon-a"), "neutral");
});

test("fresh and shared post-auth destinations activate Personal", () => {
  assert.deepEqual(
    resolvePostAuthRoute({
      requestedPath: null,
      workspaces: [personal, account, owner, staff],
    }),
    {
      redirectTo: PERSONAL_HOME_PATH,
      routeKind: "shared",
      workspaceId: personal.id,
    },
  );

  assert.deepEqual(
    resolvePostAuthRoute({
      preferredWorkspaceId: owner.id,
      requestedPath: "/more",
      workspaces: [personal, owner],
    }),
    {
      redirectTo: "/more",
      routeKind: "shared",
      workspaceId: personal.id,
    },
  );
});

test("post-auth restore chooses only valid role contexts", () => {
  assert.deepEqual(
    resolvePostAuthRoute({
      preferredWorkspaceId: owner.id,
      requestedPath: "/pos",
      workspaces: [personal, owner, staff],
    }),
    {
      redirectTo: "/pos",
      routeKind: "manage",
      workspaceId: owner.id,
    },
  );

  assert.deepEqual(
    resolvePostAuthRoute({
      preferredWorkspaceId: owner.id,
      requestedPath: "/staff/my-work",
      workspaces: [personal, owner, staff],
    }),
    {
      redirectTo: "/staff/my-work",
      routeKind: "staff",
      workspaceId: staff.id,
    },
  );

  assert.deepEqual(
    resolvePostAuthRoute({
      requestedPath: "/pos",
      workspaces: [personal, staff],
    }),
    {
      redirectTo: PERSONAL_HOME_PATH,
      routeKind: "manage",
      workspaceId: personal.id,
    },
  );
});

test("account and neutral post-auth destinations do not imply Owner mode", () => {
  assert.deepEqual(
    resolvePostAuthRoute({
      requestedPath: "/roles",
      workspaces: [personal, account, owner],
    }),
    {
      redirectTo: "/roles",
      routeKind: "account",
      workspaceId: account.id,
    },
  );

  assert.deepEqual(
    resolvePostAuthRoute({
      preferredWorkspaceId: owner.id,
      requestedPath: "/book/salon-a",
      workspaces: [personal, owner],
    }),
    {
      redirectTo: "/book/salon-a",
      routeKind: "neutral",
      workspaceId: personal.id,
    },
  );
});
