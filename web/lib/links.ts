/** A piece of text, or a link within it. */
export type Piece = string | { url: string };

// Only what is plainly a web address; anything cleverer starts turning prose into links.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/gi;
// Punctuation a sentence puts after a link, which the link itself almost never ends with.
const TRAILING = /[.,;:!?'")\]]+$/;

/** Splits text so its web addresses can be shown as links and the rest as it was written. */
export function linkify(text: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, "");
    const start = match.index;
    if (start > last) pieces.push(text.slice(last, start));
    pieces.push({ url });
    last = start + url.length;
  }
  if (last < text.length) pieces.push(text.slice(last));
  return pieces;
}
