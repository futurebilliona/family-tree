// Manual sibling order: sorting, branch layout, half-siblings, combined mode.  Run: npm test
import test from "node:test";
import strict from "node:assert/strict";
// values coming out of the vm realm have foreign prototypes: compare their plain JSON shape
const plain = v => JSON.parse(JSON.stringify(v));
const assert = { ...strict, ok: strict.ok, equal: strict.equal, deepEqual: (a, b, m) => strict.deepEqual(plain(a), plain(b), m) };
import { loadPage, family, TD, overlaps, brokenLines } from "./load-page.mjs";

// grandparents with four daughters ("the aunts"), each with her own branch
function aunts() {
  const f = family(), { add, marry } = f;
  const gf = add("Bobo", "m"), gm = add("Buvi", "f"); marry(gf, gm);
  const A = add("Aziza", "f", gf, gm, "1950"), B = add("Barno", "f", gf, gm, "1953"), C = add("Charos", "f", gf, gm, "1956"), D = add("Dilnoza", "f", gf, gm, "1960");
  const branch = {};
  for (const [aunt, name] of [[A, "a"], [B, "b"], [C, "c"], [D, "d"]]) {
    const h = add(name + "-husband", "m"); marry(aunt, h);
    const k1 = add(name + "-kid1", "m", h, aunt, "1980"), k2 = add(name + "-kid2", "f", h, aunt, "1983");
    const g1 = add(name + "-grandkid", "m", k1, null, "2005");
    branch[aunt] = [aunt, h, k1, k2, g1];
  }
  // Dilnoza gets a bigger branch so widths differ
  const d3 = add("d-kid3", "m", f.people.find(p => p.id === branch[D][1]).id, D, "1986"); branch[D].push(d3);
  return { ...f, gf, gm, A, B, C, D, branch, key: `${gf}~${gm}` };
}
const xOf = (L, id) => L.nodes.find(n => n.id === id && !n.inLaw)?.x ?? L.nodes.find(n => n.id === id).x;
const span = (L, ids) => { const xs = ids.map(id => L.nodes.find(n => n.id === id).x); return [Math.min(...xs), Math.max(...xs) + TD.w]; };

test("default stays birth-date order (nothing saved)", () => {
  const t = aunts(), pg = loadPage(t.people);
  assert.deepEqual(pg.kidsOf(t.gf).map(p => p.id), [t.A, t.B, t.C, t.D]);
  const L = pg.layoutTree(t.gf, TD);
  const xs = [t.A, t.B, t.C, t.D].map(id => xOf(L, id));
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, "aunts left-to-right by birth");
});

test("moving the 4th aunt to 1st moves her whole branch and shifts the others", () => {
  const t = aunts(), pg = loadPage(t.people);
  const before = pg.layoutTree(t.gf, TD);
  pg.setOrder({ [t.key]: [t.D, t.A, t.B, t.C] });
  assert.deepEqual(pg.kidsOf(t.gf).map(p => p.id), [t.D, t.A, t.B, t.C]);
  const L = pg.layoutTree(t.gf, TD);
  assert.deepEqual(overlaps(L.nodes), [], "no overlapping cards");
  assert.deepEqual(brokenLines(L), [], "every line ends on its child");
  // Dilnoza's whole branch (husband, children, grandchildren) is left of every other aunt's branch
  const dSpan = span(L, t.branch[t.D]);
  for (const aunt of [t.A, t.B, t.C]) assert.ok(dSpan[1] < span(L, t.branch[aunt])[0], "her branch moved as a block, others shifted right");
  // the branch keeps its own shape: every member moved by the same distance
  const dx = xOf(L, t.D) - xOf(before, t.D);
  for (const id of t.branch[t.D]) assert.ok(Math.abs(L.nodes.find(n => n.id === id).x - before.nodes.find(n => n.id === id).x - dx) < 0.01, id + " moved with the branch");
  // remaining aunts keep their relative order
  const xs = [t.D, t.A, t.B, t.C].map(id => xOf(L, id));
  assert.deepEqual([...xs].sort((a, b) => a - b), xs);
});

test("ordering never edits person records", () => {
  const t = aunts(), pg = loadPage(t.people), snap = JSON.stringify([...pg.S.people.values()]);
  pg.setOrder({ [t.key]: [t.C, t.D, t.B, t.A] });
  pg.layoutTree(t.gf, TD); pg.kidsOf(t.gf); pg.siblingsOf(pg.P(t.A));
  assert.equal(JSON.stringify([...pg.S.people.values()]), snap);
});

test("works at every generation (grandchildren too)", () => {
  const t = aunts(), pg = loadPage(t.people), [, h, k1, k2] = t.branch[t.A];
  pg.setOrder({ [`${h}~${t.A}`]: [k2, k1] });
  const L = pg.layoutTree(t.gf, TD);
  assert.ok(xOf(L, k2) < xOf(L, k1));
  assert.deepEqual(overlaps(L.nodes), []); assert.deepEqual(brokenLines(L), []);
});

test("members added later slot in by birth date; removed ones are ignored", () => {
  const t = aunts(), pg = loadPage(t.people);
  pg.setOrder({ [t.key]: [t.D, t.A, t.B, t.C, "deleted-person"] });
  const extra = { id: "late", firstName: "Eldora", gender: "f", fatherId: t.gf, motherId: t.gm, spouses: [], birthDate: "1955", createdAt: 99 };
  pg.setPeople([...t.people, extra]);
  // born 1955: before Charos (1956), the first listed sibling born after her
  assert.deepEqual(pg.kidsOf(t.gf).map(p => p.id), [t.D, t.A, t.B, "late", t.C]);
});

test("half-siblings: each mother's group orders independently and sorting stays consistent", () => {
  const f = family(), { add, marry } = f;
  const dad = add("Ota", "m"), m1 = add("Ona1", "f"), m2 = add("Ona2", "f"); marry(dad, m1); marry(dad, m2);
  const a1 = add("A1", "m", dad, m1, "1970"), a2 = add("A2", "f", dad, m1, "1974"), a3 = add("A3", "m", dad, m1, "1978");
  const b1 = add("B1", "m", dad, m2, "1972"), b2 = add("B2", "f", dad, m2, "1976");
  const pg = loadPage(f.people, { order: { [`${dad}~${m1}`]: [a3, a1, a2] } });
  const all = pg.kidsOf(dad).map(p => p.id);
  // m1's children appear in the saved order relative to each other; m2's keep birth order
  const rel = ids => all.filter(x => ids.includes(x));
  assert.deepEqual(rel([a1, a2, a3]), [a3, a1, a2]);
  assert.deepEqual(rel([b1, b2]), [b1, b2]);
  // comparator is a consistent total order: sorting any permutation gives the same result
  for (let i = 0; i < 20; i++) {
    const shuffled = [...pg.S.people.values()].filter(p => p.fatherId === dad).sort(() => Math.random() - .5);
    assert.deepEqual(shuffled.sort((x, y) => pg.kKey(x) - pg.kKey(y) || x.createdAt - y.createdAt).map(p => p.id), all);
  }
  const L = pg.layoutTree(dad, TD);
  assert.deepEqual(overlaps(L.nodes), []); assert.deepEqual(brokenLines(L), []);
  assert.ok(xOf(L, a3) < xOf(L, a1) && xOf(L, a1) < xOf(L, a2), "drawn in the saved order under their mother");
});

test("reorderGroup keeps pinned / hidden siblings in their slots", () => {
  const t = aunts(), pg = loadPage(t.people);
  // C is pinned (not movable); moving D to the front among the movable ones
  assert.deepEqual(pg.reorderGroup(t.key, [t.D, t.A, t.B]), [t.D, t.A, t.C, t.B]);
});

test("combined father+mother tree follows the saved order; the bridge person stays on the inner edge", () => {
  const t = aunts(), { add, marry } = t;
  // Charos's son marries a woman from another family → combined view centred on that couple's parents
  const [, chH, ch1] = t.branch[t.C];
  const mgf = add("OnaBobo", "m"), mgm = add("OnaBuvi", "f"); marry(mgf, mgm);
  const wife = add("Kelin", "f", mgf, mgm, "1984"); add("KelinSingil", "f", mgf, mgm, "1987");
  marry(ch1, wife); const me = add("Men", "m", ch1, wife, "2010");
  const pg = loadPage(t.people, { meId: me });
  const ctr = { h: ch1, w: wife };
  const order = [t.D, t.A, t.B, t.C];
  pg.setOrder({ [t.key]: order });
  const L = pg.combLayout(ctr, TD);
  assert.deepEqual(overlaps(L.nodes), []); assert.deepEqual(brokenLines(L), []);
  const xs = [t.D, t.A, t.B].map(id => xOf(L, id));
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, "movable aunts in saved order");
  assert.ok(L.nodes.find(n => n.id === t.C).pin, "Charos leads to the centre couple, so she is pinned");
  // and the saved order changes the combined picture
  pg.setOrder({ [t.key]: [t.B, t.A, t.D, t.C] });
  const L2 = pg.combLayout(ctr, TD), x2 = [t.B, t.A, t.D].map(id => xOf(L2, id));
  assert.deepEqual([...x2].sort((a, b) => a - b), x2);
  assert.deepEqual(overlaps(L2.nodes), []); assert.deepEqual(brokenLines(L2), []);
});

test("malformed saved orders are ignored, never hide or duplicate anyone", () => {
  const t = aunts();
  for (const bad of [[t.B, t.B, t.A], [null, 5, t.C], ["ghost", "ghost"], [], [t.D, { x: 1 }, t.A]]) {
    const pg = loadPage(t.people, { order: { [t.key]: bad } });
    const ids = pg.kidsOf(t.gf).map(p => p.id);
    assert.equal(ids.length, 4, JSON.stringify(bad)); assert.equal(new Set(ids).size, 4);
    for (const p of pg.kidsOf(t.gf)) assert.ok(Number.isFinite(pg.kKey(p)), "finite sort key");
    const L = pg.layoutTree(t.gf, TD);
    assert.equal(L.nodes.length, t.people.length, "everyone drawn"); assert.deepEqual(overlaps(L.nodes), []);
  }
  // duplicates collapse to the first occurrence
  const pg = loadPage(t.people, { order: { [t.key]: [t.C, t.C, t.A] } });
  assert.deepEqual(pg.kidsOf(t.gf).map(p => p.id).slice(0, 2), [t.C, t.A]);
});
