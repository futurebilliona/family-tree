// Sibling-order persistence through the real worker (src/worker.js) on a local D1 (Miniflare, ships with wrangler).
// Each test uses its own temp directory; nothing touches the production database.  Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";

const PASSWORD = "test-password-123", TOKEN = "backup-token-0123456789";
async function boot(dir) {
  const mf = new Miniflare({
    modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }], scriptPath: "src/worker.js", compatibilityDate: "2025-10-01",
    d1Databases: { DB: "shajara-test" }, d1Persist: join(dir, "d1"),
    bindings: { ADMIN_PASSWORD: PASSWORD, BACKUP_TOKEN: TOKEN },
    serviceBindings: { ASSETS: () => new Response("asset", { status: 200 }) },
  });
  await mf.ready;
  const call = async (path, { method = "GET", body, cookie, headers = {} } = {}) => {
    const h = { ...headers }; if (method !== "GET") h["x-sj"] = "1"; if (body !== undefined) h["content-type"] = "application/json"; if (cookie) h.cookie = cookie;
    const r = await mf.dispatchFetch("http://local" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data, setCookie: r.headers.get("set-cookie") };
  };
  const login = async () => (await call("/api/login", { method: "POST", body: { password: PASSWORD } })).setCookie.split(";")[0];
  return { mf, call, login };
}
const withDir = fn => async () => { const dir = mkdtempSync(join(tmpdir(), "sj-test-")); try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

// four sisters under one couple, from the seed so the test runs against realistic data
async function sisters(s, cookie) {
  const put = (id, d) => s.call("/api/people/" + id, { method: "PUT", cookie, body: d });
  const base = { lastName: "", patronymic: "", spouses: [], photo: null, bio: "" };
  await put("gfx", { ...base, firstName: "Bobo", gender: "m", spouses: ["gmx"] });
  await put("gmx", { ...base, firstName: "Buvi", gender: "f", spouses: ["gfx"] });
  const ids = ["s1", "s2", "s3", "s4"];
  for (const [i, id] of ids.entries()) await put(id, { ...base, firstName: "Opa" + (i + 1), gender: "f", fatherId: "gfx", motherId: "gmx", birthDate: String(1950 + i * 3) });
  return { key: "gfx~gmx", ids };
}

test("admin saves an order; it survives a restart / redeploy; people rows untouched", withDir(async dir => {
  let s = await boot(dir); const cookie = await s.login();
  const { key, ids } = await sisters(s, cookie);
  const before = (await s.call("/api/data", { cookie })).data.people;
  const order = [ids[3], ids[0], ids[1], ids[2]];
  assert.equal((await s.call("/api/order/" + key, { method: "PUT", cookie, body: { ids: order } })).status, 200);
  const after = await s.call("/api/data", { cookie });
  assert.deepEqual(after.data.order[key], order);
  assert.deepEqual(after.data.people, before, "person records (birth dates, parents, photos) unchanged");
  await s.mf.dispose();
  // new worker instance on the same database = page refresh, logout, redeploy
  s = await boot(dir);
  const visitor = await s.call("/api/data");
  assert.equal(visitor.data.admin, false);
  assert.deepEqual(visitor.data.order[key], order, "visitors see the saved order too");
  await s.mf.dispose();
}));

test("visitors cannot change the order", withDir(async dir => {
  const s = await boot(dir); const cookie = await s.login(); const { key, ids } = await sisters(s, cookie);
  assert.equal((await s.call("/api/order/" + key, { method: "PUT", body: { ids } })).status, 403);
  assert.equal((await s.call("/api/order/" + key, { method: "DELETE" })).status, 403);
  assert.equal((await s.call("/api/data")).data.order[key], undefined);
  await s.mf.dispose();
}));

test("bad input is rejected; DELETE goes back to birth order", withDir(async dir => {
  const s = await boot(dir); const cookie = await s.login(); const { key, ids } = await sisters(s, cookie);
  for (const body of [{ ids: [] }, { ids: [ids[0], ids[0]] }, { ids: "s1" }, { ids: ["bad id!"] }])
    assert.equal((await s.call("/api/order/" + key, { method: "PUT", cookie, body })).status, 400, JSON.stringify(body));
  assert.equal((await s.call("/api/order/" + encodeURIComponent("bad key!"), { method: "PUT", cookie, body: { ids } })).status, 404);
  await s.call("/api/order/" + key, { method: "PUT", cookie, body: { ids: [...ids].reverse() } });
  assert.equal((await s.call("/api/order/" + key, { method: "DELETE", cookie })).status, 200);
  assert.equal((await s.call("/api/data")).data.order[key], undefined);
  await s.mf.dispose();
}));

test("weekly backup includes the order", withDir(async dir => {
  const s = await boot(dir); const cookie = await s.login(); const { key, ids } = await sisters(s, cookie);
  await s.call("/api/order/" + key, { method: "PUT", cookie, body: { ids: [...ids].reverse() } });
  const b = await s.call("/api/backup", { headers: { authorization: "Bearer " + TOKEN } });
  assert.equal(b.status, 200); assert.deepEqual(b.data.order[key], [...ids].reverse());
  assert.ok(b.data.people.length >= 6);
  await s.mf.dispose();
}));

test("existing database without the new table: worker adds it, keeps every record; migration is idempotent", withDir(async dir => {
  const s = await boot(dir), db = await s.mf.getD1Database("DB");
  // an "old" production-like database: tables + data, already seeded, no sibling_order
  await db.batch([
    db.prepare("CREATE TABLE people (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE meta (k TEXT PRIMARY KEY, data TEXT NOT NULL)"),
    db.prepare("CREATE TABLE photos (id TEXT PRIMARY KEY, type TEXT NOT NULL, b64 TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("INSERT INTO meta (k, data) VALUES ('seeded', '{}'), ('info', '{\"title\":\"Oila\"}')"),
    db.prepare("INSERT INTO people (id, data, updated) VALUES ('old1', '{\"firstName\":\"Eski\",\"birthDate\":\"1931\"}', 1)"),
    db.prepare("INSERT INTO photos (id, type, b64, created) VALUES ('0123456789abcdef0123456789abcdef', 'image/png', 'AAAA', 1)"),
  ]);
  const r = await s.call("/api/data");                         // first request: worker creates sibling_order itself
  assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sibling_order'").first(), "table created on start-up");
  const migration = readFileSync("migrations/0001_sibling_order.sql", "utf8").split("\n").filter(l => !l.startsWith("--")).join(" ").trim();
  await db.exec(migration); await db.exec(migration);           // applying the migration by hand afterwards is harmless
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.people, [{ id: "old1", firstName: "Eski", birthDate: "1931" }], "no reseed, record intact");
  assert.deepEqual(r.data.order, {});
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM photos").first()).n, 1, "photo intact");
  await s.mf.dispose();
}));

// Production incident after PR #2: the new sibling_order table sat in the worker's start-up step and in /api/data,
// so any failure there took the whole site down (every API call 500, tree never loaded).
// Here every statement touching sibling_order fails; the family tree must still load.
test("a failing sibling_order table never takes the site down", withDir(async dir => {
  const s = await boot(dir), real = await s.mf.getD1Database("DB");
  const { onRequest } = await import("../src/api.js");
  const realOf = new WeakMap();
  const stmt = (sql, r) => { const bad = /sibling_order/.test(sql), boom = async () => { throw new Error("D1_ERROR: simulated"); };
    const o = { bind: (...a) => stmt(sql, bad ? null : r.bind(...a)), first: bad ? boom : (...a) => r.first(...a), all: bad ? boom : () => r.all(), run: bad ? boom : () => r.run() };
    realOf.set(o, bad ? null : r); return o; };
  const DB = { prepare: sql => stmt(sql, real.prepare(sql)), batch: async l => { const rs = l.map(x => realOf.get(x)); if (rs.some(x => !x)) throw new Error("D1_ERROR: simulated"); return real.batch(rs); } };
  const env = { DB, ADMIN_PASSWORD: PASSWORD };
  const errors = [], orig = console.error; console.error = (...a) => errors.push(a.join(" "));
  try {
    const call = async (path, method = "GET", body, cookie) => {
      const h = { "x-sj": "1" }; if (body) h["content-type"] = "application/json"; if (cookie) h.cookie = cookie;
      const r = await onRequest({ request: new Request("http://x/api/" + path, { method, headers: h, body: body && JSON.stringify(body) }), env, params: { path: path.split("/") } });
      return { status: r.status, data: await r.json(), cookie: r.headers.get("set-cookie") };
    };
    assert.equal((await call("me")).status, 200);
    const data = await call("data");
    assert.equal(data.status, 200, "family data still loads");
    assert.equal(data.data.people.length, 40, "all seeded people present");
    assert.deepEqual(data.data.order, {}, "falls back to birth-date order");
    const cookie = (await call("login", "POST", { password: PASSWORD })).cookie.split(";")[0];
    const put = await call("order/a~b", "PUT", { ids: ["a1", "a2"] }, cookie);
    assert.equal(put.status, 503, "saving an order reports a clear error instead");
    assert.ok(errors.some(e => /sibling_order/.test(e)), "failure is logged for Cloudflare Logs");
  } finally { console.error = orig; await s.mf.dispose(); }
}));
