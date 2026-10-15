import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const viewer = { userId: null, isAuthenticated: false };
const empty = { items: [], hasMore: false, nextCursor: null, sessionCursor: "empty-session", error: null };
const fallback = React.createElement("aside", { "data-testid": "recommendations" }, "Recommended for you");
const source = readFileSync("app/explore/explore-feed.tsx", "utf8") + "\nexport { ExploreFeedContent };";

function load(code, react = React, api = {}) {
  const exports = {};
  const dummy = new Proxy({}, { get: () => () => null });
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports, AbortController, console,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return runtime;
      if (name === "@/lib/explore-feed-client") return { ...api, exploreFeedErrorMessage: error => error.message };
      if (name.endsWith("use-explore-comment-presentation")) return { useExploreCommentPresentation: () => ({}) };
      if (name === "@/lib/explore-feed-discovery") return { matchesExploreFeedItem: () => true };
      return dummy;
    },
  });
  return exports;
}
const runtime = await import("react/jsx-runtime");
const feed = load(source);
const render = props => renderToStaticMarkup(React.createElement(feed.ExploreFeed, {
  initialPage: empty, viewer, allowRestore: false, discovery: { query: "christmas" }, emptyContent: fallback, ...props,
}));

test("genuine empty keyword feed keeps its message and places recommendations after its own section", () => {
  const html = render();
  assert.match(html, /No ideas found for this search/);
  assert.match(html, /Recommended for you/);
  assert.ok(html.indexOf("data-testid=\"recommendations\"") > html.indexOf("</section>"), "recommendations must not become matching cards or inherit the empty session's observers");
  assert.doesNotMatch(html, /You&#x27;ve explored the available results|Adjust your discovery/);
});

test("query failure and unfinished empty page never become recommendations", () => {
  for (const initialPage of [{ ...empty, error: "Query timed out." }, { ...empty, hasMore: true, nextCursor: "next" }]) {
    assert.doesNotMatch(render({ initialPage }), /Recommended for you|No ideas found/);
  }
  assert.match(render({ initialPage: { ...empty, error: "Query timed out." } }), /Query timed out/);
});

test("recommendation copy and feed ID are distinct without changing the default feed ID", () => {
  assert.match(render(), /id="explore-feed"/);
  const html = render({ feedId: "explore-search-recommendations-feed", emptyMessage: "No recommendations in this area yet." });
  assert.match(html, /id="explore-search-recommendations-feed"/);
  assert.match(html, /No recommendations in this area yet/);
  assert.doesNotMatch(html, /id="explore-feed"|No ideas found/);
});

test("discovery wrapper preserves the exact query, isolated stage session, feed ID and related continuation", () => {
  const exports = {};let passed;
  const discoverySource=readFileSync("app/explore/explore-discovery-feed.tsx","utf8");
  const deps={
    react:React,"react/jsx-runtime":runtime,
    "@/app/explore/explore-feed":{ExploreFeed:props=>{passed=props;return React.createElement('div',{id:props.feedId});},ExploreFeedSkeleton:()=>null},
    "@/lib/explore-viewport-priority":{useExploreVisibleAfterFirstContent:()=>true,useExplorePrefetchDistance:()=>900},
    "@/app/explore/nail-inspiration":{useNailInspiration:()=>({posts:[],footer:null,lookIds:[],hasMore:false})},
    "@/app/explore/explore-reference-feed":{ExploreReferenceFeed:()=>null},
    "@/lib/explore-recommendation-plan":{buildExploreRecommendationPlan:discovery=>[{discovery,label:'',description:''}],exploreRecommendationKeys:item=>[item.contentKey]},
  };
  vm.runInNewContext(ts.transpileModule(discoverySource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>deps[name]??{}});
  const discovery={query:'red nail',category:'Nails',location:'Chicago, IL',strictLocation:true};
  renderToStaticMarkup(React.createElement(exports.ExploreDiscoveryFeed,{discovery,initialPage:empty,viewer,sessionKey:'recommended:Chicago:Nails',allowRestore:false,feedId:'recommendations-feed'}));
  assert.deepEqual(passed.discovery,discovery);assert.equal(passed.sessionKey,'recommended:Chicago:Nails:stage:0');assert.equal(passed.feedId,'recommendations-feed');assert.equal(typeof passed.endContent,'function');assert.equal(passed.emptyMessage,'');
});

function shallow(api = {}) {
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const react = {
    Fragment: "fragment",
    useState(initial) {
      const at = stateIndex++;
      if (!(at in states)) states[at] = initial;
      return [states[at], next => { states[at] = typeof next === "function" ? next(states[at]) : next; }];
    },
    useRef(initial) { const at = refIndex++; return refs[at] ??= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect: fn => fn(),
  };
  const content = load(source, react, api).ExploreFeedContent;
  return props => {
    stateIndex = refIndex = 0;
    return content({ initialPage: empty, viewer, discovery: { query: "christmas" }, emptyContent: fallback, restoreSession: false, ...props });
  };
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}

test("a fully filtered final page offers a separate continuation without presenting removed rows as matching results", () => {
  const renderTree = shallow();
  const tree = renderTree({ initialPage: { ...empty, items: [{ feedKey: "look:1" }] }, filterItem: () => false });
  assert.ok(nodes(tree).some(node => node.props?.["data-testid"] === "recommendations"));
  assert.ok(!nodes(tree).some(node => node.type === "a" && node.props?.href === "#explore-search"));
});

test("refresh loading and rejected refresh do not mount the empty fallback", async () => {
  let finish;
  const renderTree = shallow({ fetchExploreFeedPage: () => new Promise(resolve => { finish = resolve; }) });
  const props = { initialPage: { ...empty, error: "Network error." } };
  const retryTree = renderTree(props);
  const refresh = nodes(retryTree).find(node => node.type === "button" && node.props?.children === "Refresh feed");
  assert.ok(refresh);
  const pending = refresh.props.onClick();
  assert.ok(!nodes(renderTree(props)).some(node => node.props?.["data-testid"] === "recommendations"));
  finish({ ...empty, error: "Query timed out." });
  await pending;
  await Promise.resolve();
  assert.ok(!nodes(renderTree(props)).some(node => node.props?.["data-testid"] === "recommendations"));
});

test("pending cache restoration does not advertise an empty search before validation", () => {
  assert.doesNotMatch(render({ allowRestore: true }), /Recommended for you|No ideas found/);
  assert.match(render({ allowRestore: true }), /aria-busy="true"/);
});

test("matching posts precede AI references across pagination, with no duplicate references", () => {
  const refs = [1,2,3].map(n => React.createElement('aside', { 'data-reference': n }, 'AI reference'));
  const real = { feedKey:'look:1',contentKey:'salon_profile_look:1' };
  for (const state of [
    {hasMore:true,nextCursor:'next'}, {hasMore:false,error:'Offline'},
  ]) {
    const tree = shallow()({ initialPage:{...empty,items:[real],...state}, supplementaryPosts:refs, restoreSession:state.restore ?? false });
    assert.equal(nodes(tree).filter(node => node.props?.['data-reference']).length,0);
  }
  const finalNodes=nodes(shallow()({ initialPage:{...empty,items:[real]},supplementaryPosts:refs }));
  assert.deepEqual(finalNodes.filter(node=>node.props?.['data-reference']).map(node=>node.props['data-reference']),[1,2,3]);
  assert.ok(finalNodes.findIndex(node=>node.props?.['data-explore-content-key']===real.contentKey) < finalNodes.findIndex(node=>node.props?.['data-reference']===1));
  const emptyNodes=nodes(shallow()({supplementaryPosts:refs}));
  assert.equal(emptyNodes.filter(node=>node.props?.['data-reference']).length,3,'an empty successful search can immediately offer paired references');
});
