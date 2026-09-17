import assert from "node:assert/strict";
import { test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileList } from "@/components/files/FileList";

test("each rendered row states its place in the whole list", () => {
  const html = renderToStaticMarkup(
    <FileList count={4000} renderRow={(i) => <span>file-{i}</span>} />,
  );
  assert.match(html, /role="list"/, "the container is a list");
  assert.match(html, /aria-setsize="4000"/, "rows report the true total, not the rendered slice");
  assert.match(html, /aria-posinset="1"/, "and their own position");
  const rendered = [...html.matchAll(/role="listitem"/g)].length;
  assert.ok(rendered > 0 && rendered < 4000, `virtualized: ${rendered} of 4000 rows in the DOM`);
});
