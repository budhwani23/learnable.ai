import json, sys, re
d = json.load(open(sys.argv[1], encoding="utf-8"))
st = d["stats"]; print("stats", {k: st[k] for k in ("expected", "unexpected", "skipped", "flaky", "duration")})
ansi = re.compile(r"\x1b\[[0-9;]*m")
def walk(s, f):
    for sp in s.get("specs", []):
        for t in sp["tests"]:
            r = t["results"][-1]
            tag = "PASS" if r["status"] == "passed" else r["status"].upper()
            print(tag, f.split("\\")[-1].split("/")[-1], "::", sp["title"])
            if tag != "PASS" and len(sys.argv) > 2:
                for e in r.get("errors", [])[:2]:
                    print("    ", ansi.sub("", (e.get("message") or "")).strip().replace("\n", "\n     ")[:500])
    for c in s.get("suites", []): walk(c, f)
for s in d["suites"]: walk(s, s["file"])
