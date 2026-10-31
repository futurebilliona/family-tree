// Loads the tree code from src/shajara.html (helpers → ordering → layout engines) into a Node vm,
// so tests exercise exactly the code the website runs. No browser needed.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../src/shajara.html", import.meta.url), "utf8");
const a = html.indexOf("/* ================= Script conversion"), b = html.indexOf("/* ================= Pan & zoom");
if (a < 0 || b < 0) throw new Error("tree code markers not found in src/shajara.html");
const CODE = html.slice(a, b);

export function loadPage(people, { order = {}, meId = null } = {}) {
  const ctx = vm.createContext({ console, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  vm.runInContext(CODE, ctx, { filename: "shajara.html#tree" });
  vm.runInContext(`S.collapsed = new Set(); S.expanded = new Set(); S.maxGen = 0; S.comb = true; S.couple = null;`, ctx);
  const api = vm.runInContext(`({ S, P, kidsOf, siblingsOf, layoutTree, combLayout, orderedGroup, reorderGroup, ordKey, sibGroup, kKey })`, ctx);
  const set = (pp, ord) => { api.S.people = new Map(pp.map(p => [p.id, structuredClone(p)])); api.S.order = new Map(Object.entries(ord)); api.S._kk = null; };
  set(people, order); api.S.meId = meId;
  return { ...api, setOrder(ord) { api.S.order = new Map(Object.entries(ord)); api.S._kk = null; }, setPeople(pp) { set(pp, Object.fromEntries(api.S.order)); } };
}

// small family-building helper
export function family() {
  const people = []; let n = 0;
  const add = (firstName, gender, fatherId = null, motherId = null, birthDate = "") => {
    const id = `p${++n}`; people.push({ id, firstName, gender, fatherId, motherId, spouses: [], birthDate, createdAt: n, lastName: "" }); return id;
  };
  const marry = (x, y) => { people.find(p => p.id === x).spouses.push(y); people.find(p => p.id === y).spouses.push(x); };
  return { people, add, marry };
}

export const TD = { w: 166, h: 196, coupleGap: 62, gap: 40, rowGap: 100, knotY: 62, busStep: 10 };

// geometry checks shared by tests
export function overlaps(nodes, w = TD.w, h = TD.h) {
  const bad = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const p = nodes[i], q = nodes[j];
    if (p.x < q.x + w && q.x < p.x + w && p.y < q.y + h && q.y < p.y + h) bad.push(p.id + "/" + q.id);
  }
  return bad;
}
// every child line must end at the centre of that child's card, one row below
export function brokenLines(L, w = TD.w) {
  const at = new Map(L.nodes.map(n => [n.id, n])), bad = [];
  for (const f of L.families) f.kidIds.forEach((id, i) => { const n = at.get(id), k = f.kids[i];
    if (!n || Math.abs(n.x + w / 2 - k.x) > 0.01 || Math.abs(n.y - k.y) > 0.01) bad.push(id); });
  return bad;
}
