import assert from "node:assert/strict";
import test from "node:test";
import { fileAllowed, takeDroppedFiles } from "./file-drop.ts";

test("image accept allows pictures and rejects documents", () => {
  assert.equal(fileAllowed({ name: "shot.png", type: "image/png" }, "image/*"), true);
  assert.equal(fileAllowed({ name: "notes.pdf", type: "application/pdf" }, "image/*"), false);
});

test("support files allow images, pdf, and text", () => {
  const accept = "image/*,.pdf,.txt";
  assert.equal(fileAllowed({ name: "shot.JPG", type: "image/jpeg" }, accept), true);
  assert.equal(fileAllowed({ name: "page.pdf", type: "application/pdf" }, accept), true);
  assert.equal(fileAllowed({ name: "notes.txt", type: "text/plain" }, accept), true);
  assert.equal(fileAllowed({ name: "sheet.csv", type: "text/csv" }, accept), false);
});

test("a drop keeps only allowed files, and a single field keeps the first", () => {
  const dropped = [
    { name: "a.png", type: "image/png" },
    { name: "b.pdf", type: "application/pdf" },
    { name: "c.jpg", type: "image/jpeg" },
  ];
  assert.deepEqual(
    takeDroppedFiles(dropped, { accept: "image/*", multiple: true, max: 4 }).map((file) => file.name),
    ["a.png", "c.jpg"],
  );
  assert.deepEqual(
    takeDroppedFiles(dropped, { accept: "image/*" }).map((file) => file.name),
    ["a.png"],
  );
});

test("a drop never keeps more than the limit", () => {
  const dropped = [1, 2, 3, 4, 5].map((n) => ({ name: `${n}.png`, type: "image/png" }));
  assert.equal(takeDroppedFiles(dropped, { accept: "image/*", multiple: true, max: 4 }).length, 4);
});

test("an empty drop adds nothing", () => {
  assert.deepEqual(takeDroppedFiles([], { accept: "image/*", multiple: true }), []);
});
