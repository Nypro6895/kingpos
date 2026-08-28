import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(
  join(process.cwd(), "app/salon-profile/salon-profile-view.tsx"),
  "utf8",
);

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `${start} should exist`);
  assert.notEqual(endIndex, -1, `${end} should exist after ${start}`);

  return source.slice(startIndex, endIndex);
}

test("salon discover is a single chronological timeline with customer shares inline", () => {
  const discover = sourceBetween("function renderDiscover()", "function renderGallery()");

  assert.match(source, /function buildTimelineItems/);
  assert.match(source, /input\.feedItems\.map/);
  assert.match(source, /input\.beautyPosts\.map/);
  assert.match(source, /timestampValue\(right\.publishedAt\) - timestampValue\(left\.publishedAt\)/);
  assert.match(discover, /visibleTimelineItems\.map/);
  assert.match(discover, /BeautyTransformationsSection/);
  assert.match(discover, /FeedCard/);
  assert.doesNotMatch(discover, /lg:grid-cols|sm:grid-cols-2|xl:grid-cols/);
  assert.doesNotMatch(source, /More to explore|CuratedLookSection/);
});

test("salon timeline loads older posts progressively and keeps each item as a full section", () => {
  assert.match(source, /const INITIAL_TIMELINE_ITEM_COUNT = 6/);
  assert.match(source, /const TIMELINE_LOAD_STEP = 4/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /timelineSentinelRef/);
  assert.match(source, /className="min-h-\[calc\(100svh-8rem\)\] scroll-mt-24/);
  assert.match(source, /min-h-\[calc\(100svh-8rem\)\]/);
});

test("gallery is an album that opens the original post and can return to timeline", () => {
  const gallery = sourceBetween("function renderGallery()", "function renderServices()");

  assert.match(source, /function buildGalleryItems/);
  assert.match(gallery, /grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4/);
  assert.match(source, /function openGalleryItem/);
  assert.match(source, /setDetailBeautyPost\(item\.post\)/);
  assert.match(source, /openTimelinePost\(item\.item\)/);
  assert.match(source, /function viewInTimeline/);
  assert.match(source, /setVisibleTimelineCount/);
  assert.match(source, /tabScrollPositions\.current\[selectedTab\] = window\.scrollY/);
  assert.match(source, /onViewInTimeline/);
});
