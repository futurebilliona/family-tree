// Sahifa claude.ai uchun yozilgan `claude.use(...)` interfeysini shu sayt serveriga (Cloudflare API) ulaydi.
(() => {
  const st = { people: new Map(), meta: {}, order: new Map(), rev: -1, admin: false, loaded: null, subs: { people: new Set(), meta: new Set(), order: new Set() } };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  async function call(url, opt = {}) {
    const headers = { "x-sj": "1", ...(opt.headers || {}) };
    if (opt.json !== undefined) { headers["content-type"] = "application/json"; opt.body = JSON.stringify(opt.json); }
    const r = await fetch(url, { method: opt.method || "GET", body: opt.body, headers, credentials: "same-origin", cache: "no-store" });
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error((data && data.error) || ("HTTP " + r.status)); e.code = r.status === 403 || r.status === 400 ? "invalid_argument" : r.status === 413 ? "too_large" : "unavailable"; e.status = r.status; throw e; }
    return data;
  }
  const snapDoc = (id, d) => { const c = clone(d); return { id, exists: d != null, data: () => (c == null ? undefined : clone(c)), metadata: { fromCache: false, hasPendingWrites: false } }; };
  const qsOf = m => { const docs = [...m].map(([id, d]) => snapDoc(id, d)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
  function emit() {
    const qs = qsOf(st.people), qo = qsOf(st.order);
    st.subs.people.forEach(f => { try { f(qs); } catch (e) { console.error(e); } });
    st.subs.order.forEach(f => { try { f(qo); } catch (e) { console.error(e); } });
    st.subs.meta.forEach(f => { try { f(snapDoc("info", st.meta)); } catch (e) { console.error(e); } });
  }
  async function refresh(force) {
    const r = await call("/api/data");
    st.admin = !!r.admin;
    // order is optional: anything unexpected is ignored so people always load
    const order = r.order && typeof r.order === "object" && !Array.isArray(r.order) ? r.order : {};
    const ordJson = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));   // key order must not matter
    if (!force && r.rev === st.rev && JSON.stringify(r.meta) === JSON.stringify(st.meta) && ordJson(order) === ordJson(Object.fromEntries([...st.order].map(([k, v]) => [k, v.ids])))) return;
    st.rev = r.rev; st.meta = r.meta || {};
    st.order = new Map(Object.entries(order).filter(([, ids]) => Array.isArray(ids)).map(([k, ids]) => [k, { ids }]));
    st.people = new Map(r.people.map(p => { const { id, ...rest } = p; return [id, rest]; }));
    emit();
  }
  const load = () => (st.loaded = st.loaded || refresh(true));
  setInterval(() => { if (document.visibilityState === "visible") refresh().catch(() => {}); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh().catch(() => {}); });

  const genId = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const u = crypto.getRandomValues(new Uint8Array(20)); for (const b of u) s += a[b % 36]; return s; };
  function docRef(path) {
    const parts = path.split("/"), coll = parts[0], id = parts[1];
    const ref = {
      id,
      async set(data) {
        if (coll === "order") { await call("/api/order/" + encodeURIComponent(id), { method: "PUT", json: { ids: data.ids } }); st.order.set(id, { ids: clone(data.ids) }); }
        else if (coll === "people") { await call("/api/people/" + encodeURIComponent(id), { method: "PUT", json: data }); st.people.set(id, clone(data)); }
        else { await call("/api/meta", { method: "PUT", json: data }); st.meta = clone(data); }
        emit();
      },
      async update(data) {
        if (coll !== "people") return ref.set({ ...st.meta, ...data });
        await call("/api/people/" + encodeURIComponent(id), { method: "PATCH", json: data });
        st.people.set(id, { ...(st.people.get(id) || {}), ...clone(data) }); emit();
      },
      async delete() {
        if (coll === "order") { await call("/api/order/" + encodeURIComponent(id), { method: "DELETE" }); st.order.delete(id); emit(); return; }
        if (coll === "people") { await call("/api/people/" + encodeURIComponent(id), { method: "DELETE" }); st.people.delete(id); emit(); } },
      onSnapshot(next, error) {
        const f = s => next(s); st.subs.meta.add(f);
        load().then(() => next(snapDoc(id, st.meta))).catch(e => error && error({ code: "unavailable", message: e.message }));
        return () => st.subs.meta.delete(f);
      }
    };
    return ref;
  }
  const db = {
    doc: docRef,
    collection(c) {
      return {
        doc: id => docRef(c + "/" + (id || genId())),
        onSnapshot(next, error) {
          const set = c === "order" ? st.subs.order : st.subs.people;
          set.add(next);
          load().then(() => next(qsOf(c === "order" ? st.order : st.people)))
            .catch(e => error && error({ code: "unavailable", message: e.message }));
          return () => set.delete(next);
        }
      };
    }
  };
  let meP = null;
  const me = () => (meP = meP || call("/api/me").then(r => { st.admin = !!r.admin; st.configured = !!r.configured; return r; }).catch(() => ({ admin: false })));
  const user = { isOwner: async () => (await me()).admin, canEdit: async () => (await me()).admin };
  const assets = {
    async upload(blob, opt = {}) { return call("/api/photos", { method: "POST", body: blob, headers: { "content-type": opt.type || blob.type || "image/jpeg" } }); },
    async delete(ref) { const id = String(ref).replace(/^.*\//, ""); return call("/api/photos/" + id, { method: "DELETE" }); }
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    }
  };
  window.claude = {
    use: async name => {
      if (name === "db") return db;
      if (name === "user") { await me(); return user; }
      if (name === "assets") { await me(); return st.admin ? assets : null; }
      if (name === "downloads") return downloads;
      return null;
    }
  };
  window.SJ = {
    get admin() { return st.admin; },
    get configured() { return st.configured !== false; },
    async login(password) { try { await call("/api/login", { method: "POST", json: { password } }); return true; } catch (e) { if (e.status === 401) return false; throw e; } },
    async logout() { await call("/api/logout", { method: "POST" }); }
  };
})();
