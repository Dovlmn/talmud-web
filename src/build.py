"""Build the site's index.html from the reader page (src/page.html), the same page that runs as the Claude artifact.

  python3 src/build.py

What changes for the standalone app:
  - a full HTML document with the app manifest, icons and theme color;
  - Firebase (compat) and config.js load before the page, then src/webapp.js, which supplies the
    storage the page asks for (window.claude.use("db"/"user")), the account and own-font settings;
  - the line that embeds the private TLT Ayala font is removed: that font is licensed for the owner only
    and is never part of this public site (add it in the app with "גופן משלי").
"""
import os, re

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
page = open(os.path.join(here, "page.html"), encoding="utf-8").read()

page = re.sub(r'^<title>.*?</title>\n', "", page)
page = re.sub(r'^<meta name="claude:[^>]*>\n', "", page, flags=re.M)
n = len(re.findall(r'^\s*FONTS\.ayala=.*\n', page, flags=re.M))
page = re.sub(r'^\s*FONTS\.ayala=.*\n', "", page, flags=re.M)
assert n == 1, "expected exactly one private-font line, found %d" % n
assert "ayala" not in page.lower(), "private font still referenced"

FB = "https://www.gstatic.com/firebasejs/10.12.2/"
head = """<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>בבלי</title>
<meta name="description" content="לימוד ש״ס בבלי: טקסט מנוקד בטורים, שטיינזלץ ורש״י, תוכנית יומית">
<meta name="theme-color" content="#28566e">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="בבלי">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<script src="%sfirebase-app-compat.js"></script>
<script src="%sfirebase-auth-compat.js"></script>
<script src="%sfirebase-firestore-compat.js"></script>
<script src="config.js"></script>
<script src="webapp.js"></script>
<style>
html.chromeless .bar{display:none!important}
#fsExit{position:fixed;z-index:7;bottom:calc(14px + env(safe-area-inset-bottom,0px));left:calc(12px + env(safe-area-inset-left,0px));width:40px;height:40px;padding:0;border-radius:50%;
  font-size:15px;background:color-mix(in srgb,var(--bar) 85%,transparent);opacity:.55;display:none}
html.chromeless #fsExit{display:block}
</style>
</head>
<body>
""".replace("%s", FB)
import time, json as _json
build = time.strftime("%Y%m%d%H%M%S", time.gmtime())
head = head.replace('<script src="config.js"></script>', '<script>window.BABLI_BUILD="%s";</script>\n<script src="config.js"></script>' % build)
out = head + page.rstrip() + "\n</body>\n</html>\n"
_json.dump({"b": build}, open(os.path.join(root, "version.json"), "w"))
open(os.path.join(root, "index.html"), "w", encoding="utf-8").write(out)
import shutil
shutil.copy(os.path.join(here, "webapp.js"), os.path.join(root, "webapp.js"))
print("index.html", len(out))
