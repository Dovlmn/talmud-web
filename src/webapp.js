/* בבלי — what the standalone app adds to the reader page:
   an account (Firebase email/password) whose Firestore holds the same records the page keeps,
   a font of your own (uploaded once, kept in your account), and a link from notifications to the next bite.
   Without a Firebase config the app works on this device only. */
(function () {
  "use strict";
  const cfg = window.TALMUD_FIREBASE;
  let auth = null, fdb = null, user = null, ctx = null, firstAuth = true;
  let readyRes; const ready = new Promise(r => (readyRes = r));
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative()) document.documentElement.classList.add("native");

  if (cfg && window.firebase) {
    try {
      firebase.initializeApp(cfg);
      auth = firebase.auth(); fdb = firebase.firestore();
      try { fdb.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
      auth.onAuthStateChanged(u => {
        const changed = (u && u.uid) !== (user && user.uid);
        user = u || null; readyRes();
        if (firstAuth) { firstAuth = false; } else if (changed && ctx) ctx.reinit();
        if (user) loadMyFonts(); refreshAccount();
      });
    } catch (e) { console.warn(e); readyRes(); }
  } else readyRes();

  // the page asks for "db" and "user"; Firestore's own API has the shape it uses (doc, collection, get, set)
  window.claude = {
    use: async name => {
      await ready;
      if (!fdb || !user) return null;
      if (name === "db") return fdb;
      if (name === "user") return { id: async () => user && user.uid };
      return null;
    }
  };

  /* ---------- account ---------- */
  const ERR = {
    "auth/invalid-email": "כתובת המייל לא תקינה.",
    "auth/missing-password": "צריך סיסמה.",
    "auth/weak-password": "הסיסמה קצרה מדי (לפחות 6 תווים).",
    "auth/email-already-in-use": "כבר יש חשבון עם המייל הזה. אפשר להיכנס.",
    "auth/invalid-credential": "המייל או הסיסמה שגויים.",
    "auth/wrong-password": "הסיסמה שגויה.",
    "auth/user-not-found": "אין חשבון עם המייל הזה. אפשר להירשם.",
    "auth/too-many-requests": "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.",
    "auth/network-request-failed": "אין חיבור לרשת."
  };
  const errTxt = e => ERR[e && e.code] || "משהו השתבש. נסה שוב.";
  let accBox = null;
  function refreshAccount() { if (accBox && accBox.isConnected) accBox.replaceWith(accountBlock()); }
  function accountBlock() {
    const h = ctx.h;
    const box = h("div", { class: "block" }, h("h3", {}, "חשבון וסנכרון"));
    accBox = box;
    if (!auth) { box.append(h("div", { class: "note" }, "הסנכרון עוד לא הוגדר. הכול נשמר במכשיר הזה בלבד.")); return box; }
    if (user) {
      box.append(h("div", {}, "מחובר כ־" + (user.email || "")),
        h("div", { class: "note" }, "התוכנית, ההערות, הסימון וההגדרות מסונכרנים בין המכשירים שלך."),
        h("div", { class: "row" }, h("button", { onclick: () => auth.signOut() }, "יציאה")));
      return box;
    }
    const em = h("input", { type: "email", dir: "ltr", placeholder: "name@example.com", autocomplete: "email" });
    const pw = h("input", { type: "password", dir: "ltr", placeholder: "סיסמה", autocomplete: "current-password" });
    const msg = h("div", { class: "note", role: "status" });
    const go = fn => async () => {
      msg.textContent = "";
      if (!em.value.trim()) { msg.textContent = "צריך מייל."; return; }
      try { await fn(em.value.trim(), pw.value); } catch (e) { msg.textContent = errTxt(e); }
    };
    box.append(h("div", { class: "note" }, "התחבר כדי לסנכרן בין הטלפון, המחשב והאייפד."),
      h("div", { class: "row" }, em, pw),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: go((a, b) => auth.signInWithEmailAndPassword(a, b)) }, "כניסה"),
        h("button", { onclick: go((a, b) => auth.createUserWithEmailAndPassword(a, b)) }, "הרשמה"),
        h("button", { class: "ghost", onclick: go(a => auth.sendPasswordResetEmail(a).then(() => { msg.textContent = "נשלח מייל לאיפוס הסיסמה."; })) }, "שכחתי סיסמה")),
      msg);
    return box;
  }

  /* ---------- a font of your own ---------- */
  // Kept in this browser (IndexedDB) and, when signed in, in your account, so it follows you to every device.
  // It is never part of the public site.
  const IDB = "babli-fonts";
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("f");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbAll() {
    try { const d = await idb(); return await new Promise(res => { const out = []; const t = d.transaction("f").objectStore("f").openCursor();
      t.onsuccess = () => { const c = t.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; t.onerror = () => res(out); }); }
    catch (e) { return []; }
  }
  async function idbPut(v) { const d = await idb(); return new Promise(res => { const t = d.transaction("f", "readwrite"); t.objectStore("f").put(v, "w" + v.w); t.oncomplete = res; t.onerror = res; }); }
  async function idbClear() { const d = await idb(); return new Promise(res => { const t = d.transaction("f", "readwrite"); t.objectStore("f").clear(); t.oncomplete = res; t.onerror = res; }); }
  // weight and family name from the font file itself
  function ttfInfo(buf) {
    const v = new DataView(buf), n = v.getUint16(4);
    let w = 400, name = "";
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16, tag = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), off = v.getUint32(o + 8);
      if (tag === "OS/2") w = v.getUint16(off + 4);
      if (tag === "name") {
        const cnt = v.getUint16(off + 2), so = off + v.getUint16(off + 4);
        let best = "";
        for (let k = 0; k < cnt; k++) {
          const r = off + 6 + k * 12, pid = v.getUint16(r), nid = v.getUint16(r + 6), len = v.getUint16(r + 8), sof = v.getUint16(r + 10);
          if ((nid === 16 || (nid === 1 && !best)) && pid === 3) { let s = ""; for (let j = 0; j < len; j += 2) s += String.fromCharCode(v.getUint16(so + sof + j)); best = s; if (nid === 16) break; }
        }
        name = best;
      }
    }
    return { w: Math.round(w / 100) * 100 || 400, name };
  }
  const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; };
  const fontsCol = () => fdb.doc("data/users/" + user.uid + "/fonts").collection("files");
  let myFonts = [];
  async function register(list) {
    myFonts = list;
    if (!list.length || !ctx) { if (ctx) delete ctx.FONTS.custom; return; }
    for (const f of list) { try { const ff = await new FontFace("MyFont", f.buf, { weight: String(f.w) }).load(); document.fonts.add(ff); } catch (e) {} }
    const ws = list.map(f => f.w);
    ctx.FONTS.custom = ['"MyFont"', null, list[0].name || "הגופן שלי", "הגופן שהעלית · משקלים " + ws.sort().join(", "), true, ws.includes(300)];
    if (ctx.fontKey() === "custom") ctx.setFont("custom", true);
  }
  async function loadMyFonts() {
    let list = await idbAll();
    if (!list.length && user && fdb) {
      try { const q = await fontsCol().get();
        list = q.docs.map(d => d.data()).filter(x => x && x.b).map(x => ({ w: x.w, name: x.name, buf: unb64(x.b) }));
        for (const f of list) await idbPut(f); } catch (e) {}
    }
    await register(list);
  }
  async function addFonts(files, msg) {
    const out = [...myFonts], skipped = [];
    for (const file of files) {
      const buf = await file.arrayBuffer();
      let info; try { info = ttfInfo(buf); } catch (e) { skipped.push(file.name); continue; }
      const rec = { w: info.w, name: info.name, buf };
      const i = out.findIndex(f => f.w === rec.w); if (i >= 0) out[i] = rec; else out.push(rec);
      await idbPut(rec);
      if (user && fdb) {
        if (buf.byteLength > 700000) skipped.push(file.name + " (גדול מדי לשמירה בחשבון; נשמר במכשיר הזה)");
        else try { await fontsCol().doc("w" + rec.w).set({ w: rec.w, name: rec.name, b: b64(buf) }); } catch (e) { skipped.push(file.name + " (לא נשמר בחשבון)"); }
      }
    }
    await register(out);
    msg.textContent = (out.length ? "נטען: " + out.map(f => f.w).sort().join(", ") + "." : "") + (skipped.length ? " " + skipped.join("; ") : "");
  }
  async function removeFonts() {
    await idbClear();
    if (user && fdb) { try { const q = await fontsCol().get(); for (const d of q.docs) await d.ref.delete(); } catch (e) {} }
    if (ctx.fontKey() === "custom") ctx.setFont("frank", true);
    await register([]);
  }
  function fontBlock() {
    const h = ctx.h;
    const inp = h("input", { type: "file", accept: ".ttf,.otf,font/ttf,font/otf", multiple: true });
    const msg = h("div", { class: "note", role: "status" });
    inp.onchange = () => { if (inp.files.length) addFonts([...inp.files], msg); };
    return h("div", { class: "block" }, h("h3", {}, "גופן משלי"),
      h("div", { class: "note" }, "קבצי TTF או OTF, משקל אחד או כמה. הגופן נשמר רק אצלך, ומופיע ברשימת הגופנים. משקל קל משמש לציטוטים ומשקל מודגש לכותרות."),
      h("div", { class: "row" }, inp, myFonts.length ? h("button", { class: "ghost", onclick: async () => { await removeFonts(); msg.textContent = "הוסר."; } }, "הסרת הגופן") : null),
      msg);
  }

  window.BABLI_WEB = {
    init(c) {
      ctx = c;
      idbAll().then(register);
      // a notification opens the app at the next bite
      if (/[?&]bite=1/.test(location.search)) {
        let n = 0; const t = setInterval(() => { n++; try { ctx.openBite(); } catch (e) {} if (document.querySelector(".u.bite") || n > 40) clearInterval(t); }, 500);
        try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
      }
    },
    blocks() { return [accountBlock(), fontBlock()]; }
  };

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
