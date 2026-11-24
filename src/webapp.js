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
        if (user) { loadMyFonts(); setupPush(); setTimeout(autoSync, 4000); } refreshAccount();
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
      const st = h("div", { class: "note", role: "status" }, "בודק את החיבור לחשבון…");
      const msg = h("div", { class: "note", role: "status" });
      box.append(h("div", {}, "מחובר כ־" + (user.email || "") + " · גרסה " + (window.BABLI_BUILD || "").slice(4, 12).replace(/(\d\d)(\d\d)(\d\d)(\d\d)/, "$2.$1 $3:$4")), st,
        h("div", { class: "row" },
          h("button", { onclick: async () => { msg.textContent = "מעלה…"; try { const n = await pushAll(); msg.textContent = "הועלו לחשבון: " + n + ". במכשיר האחר: לסגור ולפתוח."; checkAccount(st); } catch (e) { msg.textContent = syncErr(e); } } }, "העלאת הנתונים מהמכשיר הזה לחשבון"),
          h("button", { class: "ghost", onclick: () => auth.signOut() }, "יציאה")), msg);
      checkAccount(st);
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

  /* ---------- what the account holds, and pushing this device's records up to it ---------- */
  function syncErr(e) {
    const c = (e && e.code) || "";
    if (/permission-denied/.test(c)) return "✗ השרת לא מרשה לשמור. צריך לפרסם את כללי האבטחה ב־Firebase (Firestore ← Rules ← Publish).";
    if (/not-found|failed-precondition/.test(c) || /does not exist/i.test(e && e.message || "")) return "✗ מסד הנתונים לא נמצא. צריך ליצור אותו ב־Firebase (Firestore Database ← Create database).";
    if (/unavailable/.test(c)) return "✗ אין חיבור לשרת כרגע.";
    return "✗ שגיאה: " + (c || (e && e.message) || "לא ידועה");
  }
  const LSK = k => "sh2-" + k;
  const lsJ = (k, d) => { try { const v = localStorage.getItem(LSK(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  let TL = null;
  const tracts = async () => TL || (TL = (await (await fetch("tracts.json")).json()).map(t => ({ key: t.key, he: t.he, ls: t.key === "shabbat" ? "" : t.key + "-", db: t.key === "shabbat" ? "talmud" : "talmud-" + t.key })));
  const base = () => "data/users/" + user.uid + "/";
  async function checkAccount(el) {
    try {
      await fdb.doc(base() + "ping").set({ t: Date.now() });
      const pr = await fdb.doc(base() + "prefs").get({ source: "server" });
      const v = (pr.exists && pr.data().v) || {};
      let txt = "✓ מחובר לשרת, השמירה פועלת.";
      if (v.plantr) {
        const t = (await tracts()).find(x => x.key === v.plantr);
        const d = t && await fdb.doc(base() + t.db).get({ source: "server" });
        const nn = t ? (await fdb.doc(base() + t.db).collection("notes").get({ source: "server" })).size : 0;
        txt += " בחשבון: " + (d && d.exists && d.data().plan ? "תוכנית במסכת " + t.he : "אין תוכנית") + (nn ? " · הערות ב־" + nn + " עמודים" : "") + ".";
      } else txt += " בחשבון עוד אין תוכנית.";
      el.textContent = txt;
    } catch (e) { el.textContent = syncErr(e); }
  }
  // everything this device keeps locally goes up to the account (used once, from the device that has the records)
  async function pushAll() {
    let n = 0;
    for (const t of await tracts()) {
      const st = lsJ(t.ls + "st", null), notes = lsJ(t.ls + "notes", {}), nm = lsJ(t.ls + "notes-m", {});
      if (st && (st.plan || st.pos || Object.keys(st.log || {}).length)) {
        await fdb.doc(base() + t.db).set({ plan: st.plan || null, pos: st.pos || 0, posG: st.posG || 0, day: st.day || null, sums: (st.sums || []).slice(-200), log: st.log || {}, v: 4, m: Date.now() });
        n++;
      }
      const byA = {};
      for (const [k, arr] of Object.entries(notes || {})) { if (!arr || !arr.length) continue; const [a, u, g] = k.split(":"); (byA[a] = byA[a] || {})[u + ":" + g] = arr; }
      for (const [a, items] of Object.entries(byA)) { await fdb.doc(base() + t.db).collection("notes").doc("a" + a).set({ items, m: Math.max(nm[a] || 0, Date.now()) }); n++; }
    }
    const v = {};
    for (const k of ["px", "lh", "font", "stz", "rashi", "rscript", "rw", "plantr", "bm", "askSum", "justify", "refs", "niqqud", "tr"]) { const x = lsJ(k, null); if (x !== null) v[k] = x; }
    for (const t of await tracts()) { const a = lsJ(t.ls + "amud", null); if (a !== null) v["amud:" + t.key] = a; }
    const now = Date.now(), t = {}; for (const k of Object.keys(v)) t[k] = now;
    await fdb.doc(base() + "prefs").set({ v, t, m: now }); n++;
    return n;
  }

  // on every start with an account: if this device has a plan and the account has none, send everything up;
  // if the account cannot be written, say why once
  let autoDone = false;
  async function autoSync() {
    if (autoDone || !user || !fdb || !ctx) return; autoDone = true;
    try {
      await fdb.doc(base() + "ping").set({ t: Date.now() });
      const tl = await tracts();
      const localPlan = tl.some(t => { const s = lsJ(t.ls + "st", null); return s && s.plan; });
      if (!localPlan) return;
      const pr = await fdb.doc(base() + "prefs").get({ source: "server" });
      const v = (pr.exists && pr.data().v) || {};
      const t = v.plantr && tl.find(x => x.key === v.plantr);
      const remotePlan = t && (await fdb.doc(base() + t.db).get({ source: "server" })).data();
      if (remotePlan && remotePlan.plan) return;
      await pushAll();
      ctx.reinit();
    } catch (e) { autoDone = false; try { ctx.toast(syncErr(e), null, null, 9000); } catch (x) {} }
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

  /* ---------- reminders (מצב קרצייה): this phone receives them; the hourly job decides when ---------- */
  const Push = () => isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  let pushReady = false, notifyCfg = { on: true, from: 7, to: 22, eveOn: true, eve: 21 };
  try { const x = JSON.parse(localStorage.getItem("babli-notify") || "null"); if (x) notifyCfg = { ...notifyCfg, ...x }; } catch (e) {}
  const notifyDoc = () => fdb.doc("data/users/" + user.uid + "/notify");
  function openMapSoon() {
    let n = 0; const t = setInterval(() => { n++; if (ctx && ctx.status().plan !== undefined) { clearInterval(t); setTimeout(() => { try { ctx.openMap(); } catch (e) {} }, 800); } if (n > 40) clearInterval(t); }, 500);
  }
  function openBiteSoon() {
    let n = 0; const t = setInterval(() => { n++; try { ctx && ctx.openBite(); } catch (e) {} if (document.querySelector(".u.bite") || n > 40) clearInterval(t); }, 500);
  }
  async function setupPush() {
    const P = Push(); if (!P || !user || !fdb) return;
    try { const s = await notifyDoc().get(); if (s.exists) notifyCfg = { ...notifyCfg, ...s.data() }; } catch (e) {}
    if (!pushReady) {
      pushReady = true;
      P.addListener("registration", async t => {
        try { await fdb.doc("data/users/" + user.uid + "/devices").collection("list").doc(t.value.slice(-40).replace(/[^\w-]/g, "_"))
          .set({ token: t.value, t: Date.now(), platform: "android" }); } catch (e) {}
      });
      P.addListener("pushNotificationActionPerformed", () => openBiteSoon());
      try { await P.createChannel({ id: "bites", name: "ביסים", description: "תזכורת לביס הבא כשקריאת היום עוד לא הושלמה", importance: 4, vibration: true }); } catch (e) {}
    }
    if (notifyCfg.on === false) return;
    try { let p = await P.checkPermissions(); if (p.receive !== "granted") p = await P.requestPermissions(); if (p.receive === "granted") await P.register(); } catch (e) {}
  }
  function notifyBlock() {
    const h = ctx.h;
    const box = h("div", { class: "block" }, h("h3", {}, "תזכורות (מצב קרצייה)"));
    if (!LN()) { box.append(h("div", { class: "note" }, "התזכורות מגיעות לאפליקציית האנדרואיד.")); return box; }
    const save = () => { try { localStorage.setItem("babli-notify", JSON.stringify(notifyCfg)); } catch (e) {} if (user && fdb) notifyDoc().set({ on: notifyCfg.on !== false, from: notifyCfg.from, to: notifyCfg.to, eveOn: notifyCfg.eveOn !== false, eve: notifyCfg.eve ?? 21 }, { merge: true }).catch(() => {}); progress(); };
    const hours = sel => { const o = []; for (let i = 5; i <= 24; i++) o.push(h("option", { value: String(i), selected: i === sel }, String(i).padStart(2, "0") + ":00")); return o; };
    const fr = h("select", {}, hours(notifyCfg.from)), to = h("select", {}, hours(notifyCfg.to));
    fr.onchange = () => { notifyCfg.from = +fr.value; save(); }; to.onchange = () => { notifyCfg.to = +to.value; save(); };
    const tg = h("button", { "aria-pressed": String(notifyCfg.on !== false), onclick: () => { notifyCfg.on = notifyCfg.on === false; tg.setAttribute("aria-pressed", String(notifyCfg.on)); save(); if (notifyCfg.on) setupPush(); } }, "תזכורות");
    box.append(h("div", { class: "note" }, "כל עוד קריאת היום לא הושלמה: תזכורת כל שעתיים, ולחיצה עליה פותחת את הביס הבא. לא בשבת ובחג, ולא בערב שבת וערב חג אחרי 14:00."),
      h("div", { class: "row" }, tg, h("label", { class: "f" }, "משעה", fr), h("label", { class: "f" }, "עד שעה", to)));
    const ev = h("select", {}, hours(notifyCfg.eve ?? 21)); ev.onchange = () => { notifyCfg.eve = +ev.value; save(); };
    const et = h("button", { "aria-pressed": String(notifyCfg.eveOn !== false), onclick: () => { notifyCfg.eveOn = notifyCfg.eveOn === false; et.setAttribute("aria-pressed", String(notifyCfg.eveOn)); save(); } }, "מיפוי בערב");
    box.append(h("div", { class: "note" }, "פעם ביום, בשעה שתבחר: הזמנה לתת כותרות וסיכומים לפסקאות של היום שעוד אין להן סיכום. לחיצה עליה פותחת אותן."),
      h("div", { class: "row" }, et, h("label", { class: "f" }, "בשעה", ev)));
    return box;
  }

  /* ---------- the home-screen widget (Android): today's plant, the percent and the streak ---------- */
  const Widget = () => isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.PlantWidget;
  let wLast = "";
  let schedT = null;
  function progress() {
    if (!ctx) return;
    const s = ctx.status(); if (!s.plan) return;          // only the tractate that holds the plan knows today's reading
    clearTimeout(schedT); schedT = setTimeout(() => scheduleLocal(s), 2000);
    const W = Widget(); if (!W) return;
    const d = new Date(), day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const key = [day, s.pct, s.streak].join("|"); if (key === wLast) return; wLast = key;
    W.update({ day, pct: s.pct, streak: s.streak, plan: true }).catch(() => {});
  }

  /* ---------- reminders scheduled on the phone itself (reliable, no server): every two hours inside the chosen hours,
     from two hours after the last time the app was used; none once today is done, none on Shabbat and Yom Tov ---------- */
  const LN = () => isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  let hebcal = null, lnReady = false;
  async function restDay(date) {
    if (date.getDay() === 6) return true;
    try {
      hebcal = hebcal || await import("https://cdn.jsdelivr.net/npm/@hebcal/core@5.8.0/+esm");
      return (hebcal.HebrewCalendar.getHolidaysOnDate(new hebcal.HDate(date), true) || []).some(e => e.getFlags() & hebcal.flags.CHAG);
    } catch (e) { return false; }
  }
  const now0 = () => new Date();
  async function scheduleLocal(s) {
    const L = LN(); if (!L || !ctx) return;
    try {
      if (!lnReady) {
        lnReady = true;
        L.addListener("localNotificationActionPerformed", (e) => { const x = e && e.notification && e.notification.extra; if (x && x.map) openMapSoon(); else openBiteSoon(); });
        try { await L.createChannel({ id: "bites", name: "ביסים", description: "תזכורת לביס הבא כשקריאת היום עוד לא הושלמה", importance: 4, vibration: true }); } catch (e) {}
        let p = await L.checkPermissions(); if (p.display !== "granted") p = await L.requestPermissions();
      }
      const ids = []; for (let i = 0; i < 60; i++) ids.push({ id: 900 + i });
      try { await L.cancel({ notifications: ids }); } catch (e) {}
      // the evening invitation to give titles and summaries (today: only if something learned today is still unsummarized)
      const evs = [];
      if (notifyCfg.eveOn !== false) {
        const H = notifyCfg.eve ?? 21;
        for (let dd = 0; dd < 3; dd++) {
          const day = new Date(now0().getFullYear(), now0().getMonth(), now0().getDate() + dd);
          const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), H, 0);
          if (at.getTime() < Date.now() + 60e3) continue;
          if (await restDay(day)) continue;
          if (day.getDay() === 5 || await restDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))) continue;
          if (dd === 0 && !s.unmapped) continue;
          evs.push({ id: 950 + dd, title: "בבלי · מיפוי", body: dd === 0 ? "יש " + s.unmapped + (s.unmapped === 1 ? " פסקה" : " פסקאות") + " מהיום בלי סיכום. כמה דקות לכותרות ולסיכומים?" : "ערב טוב. כמה דקות לכותרות ולסיכומים של מה שלמדת היום?",
            schedule: { at, allowWhileIdle: true }, channelId: "bites", smallIcon: "ic_stat_babli", extra: { map: 1 } });
        }
      }
      if (evs.length) await L.schedule({ notifications: evs });
      if (notifyCfg.on === false) return;
      const from = notifyCfg.from ?? 7, to = notifyCfg.to ?? 22, now = new Date(), out = []; let id = 900;
      for (let dd = 0; dd < 3; dd++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dd);
        if (dd === 0 && s.pct >= 100) continue;
        if (await restDay(day)) continue;
        const eve = day.getDay() === 5 || await restDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1));
        const end = Math.min(to, eve ? 14 : 24);
        let t = dd === 0 ? now.getTime() + 2 * 3600e3 : new Date(day.getFullYear(), day.getMonth(), day.getDate(), from).getTime();
        for (; out.length < 36; t += 2 * 3600e3) {
          const d = new Date(t); if (d.getDate() !== day.getDate()) break;
          const hh = d.getHours() + d.getMinutes() / 60;
          if (hh < from) { t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from).getTime() - 2 * 3600e3; continue; }
          if (hh >= end) break;
          const started = dd === 0 && s.pct > 0;
          out.push({ id: id++, title: "בבלי", body: (started ? "התחלת היום (" + s.pct + "%). עוד ביס אחד?" : "עוד לא התחלת היום. ביס אחד קטן?") + (s.streak ? " · רצף " + s.streak : ""),
            schedule: { at: d, allowWhileIdle: true }, channelId: "bites", smallIcon: "ic_stat_babli", extra: { bite: 1 } });
        }
      }
      if (out.length) await L.schedule({ notifications: out });
    } catch (e) { console.warn(e); }
  }
  async function launchedFromWidget() {
    const W = Widget(); if (!W) return;
    try { const r = await W.consumeLaunch(); if (r && r.bite) openBiteSoon(); } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { launchedFromWidget(); progress(); } });

  /* ---------- full screen in the app: the app's bar and Android's own bars step aside ---------- */
  function setFs(on) {
    document.documentElement.classList.toggle("chromeless", on);
    try { localStorage.setItem("babli-fs", on ? "1" : "0"); } catch (e) {}
    const fb = document.getElementById("fsBtn"); if (fb) fb.setAttribute("aria-pressed", String(on));
    const U = isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemUi;
    if (U) U.setImmersive({ on }).catch(() => {});
    setTimeout(() => { try { ctx.relayout(); } catch (e) {} }, 250);
  }
  function setupFullscreen() {
    if (!isNative()) return;                       // in a browser the page's own full-screen button is used
    const fb = document.getElementById("fsBtn"); if (!fb) return;
    fb.hidden = false; fb.onclick = () => setFs(!document.documentElement.classList.contains("chromeless"));
    const ex = document.createElement("button"); ex.id = "fsExit"; ex.textContent = "⛶"; ex.setAttribute("aria-label", "יציאה ממסך מלא");
    ex.onclick = () => setFs(false); document.body.appendChild(ex);
    // with Android's back button available, it leaves full screen and the round button is not needed
    const App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.addListener) {
      ex.remove();
      App.addListener("backButton", (e) => {
        if (document.documentElement.classList.contains("chromeless")) { setFs(false); return; }
        const sc = document.getElementById("scrim");
        if (sc && !sc.hidden) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return; }
        if (e && e.canGoBack) history.back(); else App.exitApp();
      });
    }
    let on = false; try { on = localStorage.getItem("babli-fs") === "1"; } catch (e) {}
    if (on) setFs(true);
  }

  window.BABLI_WEB = {
    init(c) {
      ctx = c;
      launchedFromWidget();
      setupFullscreen();
      idbAll().then(register);
      // a notification opens the app at the next bite
      if (/[?&]bite=1/.test(location.search)) {
        openBiteSoon();
        try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
      }
    },
    blocks() { return [accountBlock(), notifyBlock(), fontBlock()]; },
    fullscreen(on) { if (!isNative()) return false; setFs(on); return true; },
    progress
  };

  /* ---------- a newer version: the app on a phone can stay open for days, so it checks when it comes back ---------- */
  async function checkVersion() {
    try {
      const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) return;
      const b = (await r.json()).b;
      if (b && window.BABLI_BUILD && b !== window.BABLI_BUILD) {
        const busy = () => !document.getElementById("scrim").hidden || document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
        if (busy()) return;
        location.reload();
      }
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });
  setInterval(checkVersion, 20 * 60 * 1000);
  setTimeout(checkVersion, 5000);

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();

// keep the screen on while the reader is open (browsers that support it; the Android app does this natively)
(function () {
  if (!("wakeLock" in navigator)) return;
  // only on iPad (and Android browsers); never on computers
  const ua = navigator.userAgent, ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!ipad && !/Android/.test(ua)) return;
  let lock = null;
  const get = async () => { try { if (document.visibilityState === "visible" && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {} };
  document.addEventListener("visibilitychange", get);
  ["click", "touchstart", "keydown"].forEach(ev => document.addEventListener(ev, get, { passive: true }));
  get();
})();
