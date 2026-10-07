import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { prepareCommentRequest, completeCommentRequest } from "../lib/comment-request.ts";
import { withRequestTimeout } from "../lib/request-timeout.ts";

function commentHarness(create, load = async () => ({ items: [], totalCount: 0, hasMore: false, nextOffset: null, error: null }), supabase = null) {
  const states = [], refs = [], pending = [], effects = [];
  const timers = new Map();
  let si = 0, ri = 0, ei = 0, timerId = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("app/post-comments/post-comment-thread.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    crypto: { randomUUID },
    URLSearchParams,
    document: { visibilityState: "visible", getElementById: () => null },
    window: { sessionStorage: null, location: { search: "" }, addEventListener() {}, removeEventListener() {},
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); } },
    require(name) {
      if (name === "@/lib/comment-request") return { prepareCommentRequest, completeCommentRequest };
      if (name === "@/lib/request-timeout") return { withRequestTimeout };
      if (name === "@/lib/post-comments-client") return { fetchPostCommentsPage: load };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
        useState(initial) {
          const index = si++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        },
        useRef(initial) { return refs[ri++] ??= { current: initial }; },
        useEffect(callback) { effects[ei++] ??= callback; }, useMemo: callback => callback(),
        useTransition: () => [false, callback => pending.push(callback())],
      };
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
      if (name.includes("post-comments/actions")) return { createPostCommentAction: create, loadPostCommentsAction: load };
      if (name.includes("supabase/browser")) return { createSupabaseBrowserClient: () => supabase };
      throw new Error(name);
    },
  });
  const props = {
    target: { sourceId: "post", sourceType: "beauty_post" },
    viewer: { isAuthenticated: true, userId: "user", canReplyAsSalon: false, canModerate: false },
  };
  function render() {
    si = ri = ei = 0;
    const outer = exports.PostCommentThread(props);
    return outer.type(outer.props);
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  }
  const find = type => nodes(render()).find(node => node.type === type).props;
  let cleanups = [];
  return {
    mount: () => { render(); cleanups = effects.map(callback => callback()); },
    unmount: () => { cleanups.forEach(cleanup => cleanup?.()); },
    flushTimers: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    commentBodies: () => nodes(render()).filter(node => node.props?.comment).map(node => node.props.comment.body),
    loadMore: () => nodes(render()).find(node => node.type === "button" && node.props.children === "Load more").props.onClick(),
    write: value => find("textarea").onChange({ currentTarget: { value } }),
    submit: () => find("form").onSubmit({ preventDefault() {} }),
    body: () => find("textarea").value,
    status: () => nodes(render()).find(node => node.props?.["aria-live"] === "polite").props.children,
    settle: () => Promise.all(pending),
  };
}

function realtimeClient() {
  const channels = new Map();
  const removed = [];
  return {
    channels, removed,
    channel(topic) {
      if (channels.has(topic)) return channels.get(topic);
      const channel = {
        subscribed: false,
        on(type, filter, callback) {
          if (this.subscribed) throw new Error("cannot add postgres_changes callbacks after subscribe()");
          this.payload = callback;
          this.filter = filter;
          return this;
        },
        subscribe(callback) { this.subscribed = true; this.status = callback; return this; },
      };
      channels.set(topic, channel);
      return channel;
    },
    // Retain the old channel to reproduce cleanup that has not completed yet.
    removeChannel(channel) { removed.push(channel); return Promise.resolve("ok"); },
  };
}

test("comment effect replay does not reuse a subscribed channel before removal completes", () => {
  const client = realtimeClient();
  let loads = 0;
  const load = async () => { loads++; return { items: [], totalCount: 0, hasMore: false, nextOffset: null, error: null }; };
  const ui = commentHarness(async () => ({}), load, client);
  ui.mount();
  const old = [...client.channels.values()][0];
  ui.unmount();
  assert.doesNotThrow(() => ui.mount());
  assert.equal(client.channels.size, 2);
  assert.equal(client.removed[0], old);
  const before = loads;
  old.status("SUBSCRIBED");
  old.payload({ eventType: "INSERT", new: {}, old: {} });
  ui.flushTimers();
  assert.equal(loads, before, "removed channel must not schedule comment refreshes");
  ui.unmount();
});

test("two comment panels for the same post subscribe independently with the same data filter", () => {
  const client = realtimeClient();
  const first = commentHarness(async () => ({}), undefined, client);
  const second = commentHarness(async () => ({}), undefined, client);
  first.mount();
  assert.doesNotThrow(() => second.mount());
  const [a, b] = [...client.channels.values()];
  assert.equal(client.channels.size, 2);
  assert.deepEqual({ ...a.filter }, { ...b.filter });
  first.unmount();
  assert.equal(client.removed.length, 1);
  assert.equal(client.removed[0], a);
  second.unmount();
});

test("realtime updates during the first load preserve its result and coalesce the follow-up", async () => {
  const client = realtimeClient();
  let finish, calls = 0;
  const row = { id: "existing", body: "Already visible", targetId: "post", targetType: "beauty_post", createdAt: "2026-09-24", parentCommentId: null };
  const ui = commentHarness(async () => ({}), () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  }, client);
  ui.mount();
  const channel = [...client.channels.values()][0];
  channel.status("SUBSCRIBED");
  for (let i = 0; i < 5; i++) channel.payload({ eventType: "INSERT", new: {}, old: {} });
  ui.flushTimers();
  assert.equal(calls, 1);
  finish({ items: [row], totalCount: 1, hasMore: false, nextOffset: null, error: null });
  await ui.settle();
  assert.deepEqual(ui.commentBodies(), ["Already visible"]);
  ui.flushTimers();
  assert.equal(calls, 2, "all queued events reconcile in one follow-up read");
  finish({ items: [row], totalCount: 1, hasMore: false, nextOffset: null, error: null });
  await ui.settle();
  ui.unmount();
});

test("a failed background refresh keeps the previously loaded comments visible", async () => {
  const client = realtimeClient();
  let calls = 0;
  const row = { id: "existing", body: "Keep reading", targetId: "post", targetType: "beauty_post", createdAt: "2026-09-24", parentCommentId: null };
  const ui = commentHarness(async () => ({}), async () => {
    if (++calls > 1) throw new Error("offline");
    return { items: [row], totalCount: 1, hasMore: false, nextOffset: null, error: null };
  }, client);
  ui.mount(); await ui.settle();
  [...client.channels.values()][0].status("SUBSCRIBED");
  ui.flushTimers(); await ui.settle();
  assert.deepEqual(ui.commentBodies(), ["Keep reading"]);
  ui.unmount();
});

test("refresh displays its first page before later pages finish and preserves content while waiting", async () => {
  const client = realtimeClient();
  let phase = "initial", finish;
  const row = (id, body) => ({ id, body, targetId: "post", targetType: "beauty_post", createdAt: "2026-09-24", parentCommentId: null });
  const ui = commentHarness(async () => ({}), async ({ offset }) => {
    if (phase === "refresh" && offset === 10) return new Promise(resolve => { finish = resolve; });
    return offset === 0
      ? { items: [row("first", phase === "refresh" ? "Updated first page" : "First page")], totalCount: 2, hasMore: true, nextOffset: 10, error: null }
      : { items: [row("second", "Second page")], totalCount: 2, hasMore: false, nextOffset: null, error: null };
  }, client);
  ui.mount(); await ui.settle();
  ui.loadMore(); await ui.settle();
  phase = "refresh";
  [...client.channels.values()][0].status("SUBSCRIBED");
  ui.flushTimers();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(ui.commentBodies(), ["Updated first page", "Second page"]);
  finish({ items: [row("second", "Updated second page")], totalCount: 2, hasMore: false, nextOffset: null, error: null });
  await ui.settle();
  assert.deepEqual(ui.commentBodies(), ["Updated first page", "Updated second page"]);
  ui.unmount();
});

test("comment transport failure restores draft and allows a later explicit retry", async () => {
  let calls = 0;
  const ui = commentHarness(async () => { calls++; throw new TypeError("Failed to fetch"); });
  ui.write("audit draft"); ui.submit();
  assert.equal(ui.body(), "");
  await ui.settle();
  assert.equal(ui.body(), "audit draft");
  assert.match(ui.status(), /Refresh to check/);
  ui.submit(); await ui.settle();
  assert.equal(calls, 2);
});

test("a stale comment load cannot overwrite a successful send", async () => {
  let finishLoad;
  const posted = { id: "saved", body: "New comment", targetId: "post", targetType: "beauty_post", createdAt: "2026-09-24", parentCommentId: null };
  const ui = commentHarness(async () => ({ error: null, comment: posted, totalCount: 1 }),
    () => new Promise(resolve => { finishLoad = resolve; }));
  ui.mount();
  ui.write("New comment"); ui.submit();
  await new Promise(resolve => setTimeout(resolve, 0));
  finishLoad({ items: [], totalCount: 0, hasMore: false, nextOffset: null, error: null });
  await ui.settle();
  assert.deepEqual(ui.commentBodies(), ["New comment"]);
});

test("a second submit while a comment is pending does not create a duplicate", async () => {
  let calls = 0, complete;
  const ui = commentHarness(() => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  });
  ui.write("first"); ui.submit();
  ui.write("second"); ui.submit();
  assert.equal(calls, 1);
  complete({ error: "Rejected" });
  await ui.settle();
  assert.equal(ui.body(), "second", "a rejected earlier send must preserve the newer draft");
});

test("explicit retry after a lost response reuses the same request ID", async () => {
  const ids = [];
  const ui = commentHarness(async input => { ids.push(input.requestId); throw new TypeError("offline"); });
  ui.write("idempotent draft"); ui.submit(); await ui.settle();
  ui.submit(); await ui.settle();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
});

test("mixed feeds preserve personal post counts while enriching salon counts", async () => {
  const exports = {};
  const source = readFileSync("lib/explore-feed.ts", "utf8") + "\nexport { attachFeedCommentCounts };";
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name) {
      if (name === "@/lib/post-comments") return {
        getPostCommentCounts: async () => new Map([["salon", 5]]),
        getPostCommentCount: (counts, target) => counts.get(target.sourceId) ?? 0,
      };
      return {};
    },
  });
  const items = await exports.attachFeedCommentCounts([
    { sourceType: "personal", caption: "Personal", commentCount: 3, saveTarget: { sourceId: "personal", sourceType: "beauty_post" } },
    { sourceType: "salon", caption: "Salon", commentCount: 0, saveTarget: { sourceId: "salon", sourceType: "salon_profile_look" } },
  ]);
  assert.equal(items[0].commentCount, 3);
  assert.equal(items[1].commentCount, 5);
});
