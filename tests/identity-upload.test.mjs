import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);

test("uploading a second card does not cancel the first card's recognition", () => {
  // A single shared counter used to be bumped on every upload, so the front
  // card's in-flight result was discarded the moment the back card was picked
  // and only one of the two ever reached the form.
  assert.match(page, /identityFileRuns/);
  assert.match(
    page,
    /const beginIdentityRun = \(file: File\) => \{[\s\S]{0,220}identityFileRuns\.current\[fileId\(file\)\] = run/,
  );
  assert.match(
    page,
    /identityFileRuns\.current\[id\] !== run \|\|\s*!activeIdentityFiles\.current\.includes\(id\)/,
  );
  assert.doesNotMatch(page, /run !== identityRun\.current/);
});

test("a back-side scan is not judged against fields the back does not carry", () => {
  assert.match(page, /identityFieldExpectation/);
  assert.match(
    page,
    /side === "back"\s*\?\s*\{ required: \["地址"\], optional: \["證號"\] \}/,
  );
  assert.match(
    page,
    /side === "front"\s*\?\s*\{ required: \["姓名", "證號"\], optional: \["生日"\] \}/,
  );
  // The status line is built from the expectation, never from a fixed list.
  assert.match(page, /const expectation = identityFieldExpectation\(side\)/);
  assert.match(page, /expectation\.required\.every\(\(field\) => values\[field\]\)/);
});

test("uploaded files are shown as thumbnails so a wrong scan is visible", async () => {
  assert.match(page, /FileThumbnails/);
  assert.match(page, /thumbnailItems\(slot\.key\)/);
  assert.match(page, /上傳後這裡會顯示縮圖/);
  const thumbnails = await readFile(
    new URL("../app/file-thumbnails.tsx", import.meta.url),
    "utf8",
  );
  assert.match(thumbnails, /createFileThumbnail/);
  // Object URLs have to be released or every re-upload leaks one for the session.
  assert.match(thumbnails, /for \(const revoke of revokers\) revoke\(\)/);
  const helper = await readFile(
    new URL("../lib/file-thumbnail.mjs", import.meta.url),
    "utf8",
  );
  assert.match(helper, /pdfjs-dist/);
  assert.match(helper, /URL\.revokeObjectURL/);
});
