import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { rolldown } from "rolldown";
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "node_modules", ".cache", "file-drop-bundle.mjs");

test("upload control shows a button, the file name, a thumbnail, and remove", async () => {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const bundle = await rolldown({
    input: path.join(root, "src/components/file-drop.tsx"),
    platform: "node",
    external: ["react", "react/jsx-runtime", "react-dom", "react-dom/server"],
    resolve: {
      alias: { "@": path.join(root, "src") },
    },
  });
  try {
    await bundle.write({ file: outfile, format: "esm" });
    const dropped = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
    const require = createRequire(path.join(root, "package.json"));
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const html = renderToStaticMarkup(
      React.createElement(dropped.FileDrop, {
        label: "Upload screenshot",
        accept: "image/*,.pdf,.txt",
        multiple: true,
        items: [{ name: "shot.png", preview: "data:image/png;base64,aaaa" }, { name: "notes.pdf" }],
        onFiles() {},
        onRemove() {},
      }),
    );
    assert.match(html, /Upload screenshot/);
    assert.match(html, /ua-upload-btn/);
    assert.match(html, /shot\.png/);
    assert.match(html, /notes\.pdf/);
    assert.match(html, /data:image\/png/);
    assert.match(html, /aria-label="Remove shot.png"/);
    assert.match(html, /aria-label="Remove notes.pdf"/);
    assert.match(html, /class="ua-file-native"/);
    assert.match(html, /<button[^>]*type="button"[^>]*>/);
    const fileInput = html.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? "";
    assert.match(fileInput, /ua-file-native/);
  } finally {
    await bundle.close();
    fs.rmSync(outfile, { force: true });
  }
});
