# בבלי

לימוד ש״ס בבלי: טקסט מנוקד בטורים צרים ומסכים מלאים, חלוקה לוגית לפי דוברים וטיעונים, שטיינזלץ ורש״י משולבים בטקסט, תוכנית יומית של 3 דפים לפי מספר מילים, ביסים, הערות ומפת מסכת.

האתר: https://dovlmn.github.io/talmud-web/ — אפליקציית האנדרואיד (מאגר `talmud-android`) טוענת אותו.

## מבנה
- `src/page.html` — עמוד הקורא (אותו עמוד שרץ גם כ־artifact ב־Claude).
- `src/webapp.js` — מה שהאפליקציה העצמאית מוסיפה: חשבון וסנכרון (Firebase), גופן משלי, פתיחה מהתראה.
- `src/build.py` — בונה את `index.html` מ־`src/page.html`. להריץ אחרי כל שינוי בעמוד: `python3 src/build.py`.
- `config.js` — הגדרות Firebase (`null` = בלי סנכרון, הכול במכשיר בלבד).
- `firestore.rules` — כללי האבטחה להדבקה ב־Firebase console (Firestore → Rules).
- תיקייה לכל מסכת: `data.json` (גמרא מנוקדת ביחידות), `stz.json` (שטיינזלץ משולב), `rashi.json` (רש״י משולב), `ctx.json` + `refs.json` (מקורות הציטוטים), `sugyot.json` (חלוקה לסוגיות).

## מקורות וזכויות
- נוסח מנוקד: William Davidson Edition (Koren), ניקוד Dicta, דרך Sefaria — CC-BY-NC.
- ביאור שטיינזלץ: William Davidson Edition – Hebrew, דרך Sefaria — CC-BY-NC.
- רש״י (ורשב״ם בבבא בתרא): דפוס וילנא, דרך Sefaria.
- גופן כתב רש״י: Mekorot (OFL) — `fonts/mekorot-OFL.txt`. המשקלים הדקים נגזרו מציר המשקל של הגופן.
- גופנים מסחריים אינם חלק מהמאגר. גופן פרטי מוסיפים באפליקציה ב״גופן משלי״, והוא נשמר רק בחשבון של המשתמש.
