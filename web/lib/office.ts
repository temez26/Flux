import type JSZip from "jszip";
import { loadBytes } from "./preview";

const MAX_ROWS = 1000;
const MAX_COLUMNS = 100;
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** Days from Excel's epoch (1899-12-30) to the Unix epoch. */
const EXCEL_UNIX_DAYS = 25569;

export interface Sheet {
  name: string;
  rows: string[][];
  truncated: boolean;
}

async function openZip(url: string, signal: AbortSignal): Promise<JSZip> {
  const [{ default: JSZip }, data] = await Promise.all([import("jszip"), loadBytes(url, signal)]);
  return JSZip.loadAsync(data);
}

async function readXml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path);
  return file && new DOMParser().parseFromString(await file.async("text"), "application/xml");
}

// Namespace prefixes are only conventional (Strict OOXML uses other namespaces), so match local names.
const descendants = (node: Element | Document, name: string) => Array.from(node.getElementsByTagNameNS("*", name));
const relationId = (el: Element) => Array.from(el.attributes).find((a) => a.localName === "id" && a.namespaceURI)?.value ?? "";

/** Maps a package part's relationship ids to the paths they point to. */
async function relationships(zip: JSZip, part: string): Promise<Map<string, string>> {
  const dir = part.slice(0, part.lastIndexOf("/"));
  const doc = await readXml(zip, `${dir}/_rels/${part.slice(dir.length + 1)}.rels`);
  const map = new Map<string, string>();
  for (const rel of doc ? descendants(doc, "Relationship") : []) {
    const target = rel.getAttribute("Target") ?? "";
    const path = target.startsWith("/") ? [] : dir.split("/");
    for (const segment of target.split("/")) {
      if (segment === "..") path.pop();
      else if (segment && segment !== ".") path.push(segment);
    }
    map.set(rel.getAttribute("Id") ?? "", path.join("/"));
  }
  return map;
}

const textOf = (el: Element) =>
  descendants(el, "t")
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent)
    .join("");

const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""));

/** Indexes of the cell styles that display numbers as dates. */
async function dateStyles(zip: JSZip): Promise<Set<number>> {
  const doc = await readXml(zip, "xl/styles.xml");
  const styles = new Set<number>();
  if (!doc) return styles;
  const custom = new Set(
    descendants(doc, "numFmt")
      .filter((f) => isDateFormat(f.getAttribute("formatCode") ?? ""))
      .map((f) => Number(f.getAttribute("numFmtId"))),
  );
  const cellXfs = descendants(doc, "cellXfs")[0];
  (cellXfs ? descendants(cellXfs, "xf") : []).forEach((xf, i) => {
    const id = Number(xf.getAttribute("numFmtId"));
    if (BUILTIN_DATE_FORMATS.has(id) || custom.has(id)) styles.add(i);
  });
  return styles;
}

function formatSerialDate(serial: number): string {
  const date = new Date(Math.round((serial - EXCEL_UNIX_DAYS) * 86_400_000));
  return Number.isInteger(serial) ? date.toLocaleDateString(undefined, { timeZone: "UTC" }) : date.toLocaleString(undefined, { timeZone: "UTC" });
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + code - 64;
  }
  return n - 1;
}

function cellValue(cell: Element, strings: string[], dates: Set<number>): string {
  const value = descendants(cell, "v")[0]?.textContent ?? "";
  switch (cell.getAttribute("t")) {
    case "s":
      return strings[Number(value)] ?? "";
    case "inlineStr":
      return textOf(cell);
    case "b":
      return value === "1" ? "TRUE" : "FALSE";
    case "str":
    case "e":
    case "d":
      return value;
  }
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return value;
  if (dates.has(Number(cell.getAttribute("s")))) return formatSerialDate(n);
  // Stored doubles carry binary noise (0.30000000000000004) that spreadsheets never show.
  return String(parseFloat(n.toPrecision(15)));
}

function readRows(doc: Document, strings: string[], dates: Set<number>): Omit<Sheet, "name"> {
  const rows: string[][] = [];
  let truncated = false;
  let nextRow = 0;
  for (const row of descendants(doc, "row")) {
    const r = row.hasAttribute("r") ? Number(row.getAttribute("r")) - 1 : nextRow;
    nextRow = r + 1;
    if (r >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const cells: string[] = [];
    let nextColumn = 0;
    for (const cell of descendants(row, "c")) {
      const ref = cell.getAttribute("r");
      const column = ref ? columnIndex(ref) : nextColumn;
      nextColumn = column + 1;
      if (column >= MAX_COLUMNS) {
        truncated = true;
        continue;
      }
      const value = cellValue(cell, strings, dates);
      if (value) cells[column] = value;
    }
    if (cells.length) rows[r] = cells;
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows: Array.from(rows, (row) => Array.from({ length: width }, (_, i) => row?.[i] ?? "")), truncated };
}

/** The first rows and columns of every sheet, as displayed text. */
export async function readWorkbook(url: string, signal: AbortSignal): Promise<Sheet[]> {
  const zip = await openZip(url, signal);
  const book = await readXml(zip, "xl/workbook.xml");
  if (!book) throw new Error("Not a workbook");
  const [rels, shared, dates] = await Promise.all([
    relationships(zip, "xl/workbook.xml"),
    readXml(zip, "xl/sharedStrings.xml"),
    dateStyles(zip),
  ]);
  const strings = shared ? descendants(shared, "si").map(textOf) : [];
  const sheets: Sheet[] = [];
  for (const sheet of descendants(book, "sheet")) {
    const doc = await readXml(zip, rels.get(relationId(sheet)) ?? "");
    const name = sheet.getAttribute("name") ?? `Sheet ${sheets.length + 1}`;
    sheets.push({ name, ...(doc ? readRows(doc, strings, dates) : { rows: [], truncated: false }) });
  }
  return sheets;
}

/** The text paragraphs of each slide, in presentation order. */
export async function readSlides(url: string, signal: AbortSignal): Promise<string[][]> {
  const zip = await openZip(url, signal);
  const presentation = await readXml(zip, "ppt/presentation.xml");
  if (!presentation) throw new Error("Not a presentation");
  const rels = await relationships(zip, "ppt/presentation.xml");
  return Promise.all(
    descendants(presentation, "sldId").map(async (slide) => {
      const doc = await readXml(zip, rels.get(relationId(slide)) ?? "");
      if (!doc) return [];
      return descendants(doc, "p")
        .map((p) => textOf(p).trim())
        .filter(Boolean);
    }),
  );
}

/** Renders a .docx into a shadow root, so the document's styles can't reach the app. */
export async function renderDocx(url: string, signal: AbortSignal, root: ShadowRoot): Promise<void> {
  const [{ renderAsync }, data] = await Promise.all([import("docx-preview"), loadBytes(url, signal)]);
  const styles = document.createElement("div");
  const overrides = document.createElement("style");
  overrides.textContent =
    ".docx-wrapper{background:none;padding:0;gap:16px}.docx-wrapper>section.docx{margin:0;box-shadow:0 1px 4px rgb(0 0 0/.3)}";
  const body = document.createElement("div");
  root.replaceChildren(styles, overrides, body);
  // Alt chunks are embedded HTML rendered in same-origin frames, so they could run scripts.
  await renderAsync(data, body, styles, { renderAltChunks: false, ignoreFonts: true });
  for (const link of body.querySelectorAll("a")) {
    if (/^(https?|mailto):/i.test(link.getAttribute("href") ?? "")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      // javascript: links would run on this origin; in-document anchors can't resolve in a shadow root.
      link.removeAttribute("href");
    }
  }
}
