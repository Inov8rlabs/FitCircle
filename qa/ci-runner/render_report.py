#!/usr/bin/env python3
"""Render a run directory (results.tsv + per-suite JUnit/screenshots) into index.html + summary.json.

usage: render_report.py <run_dir> <kind>   → prints a plain-text summary (first line = one-liner)
"""
import html
import json
import os
import sys
import xml.etree.ElementTree as ET

run_dir, kind = sys.argv[1], sys.argv[2]
rows = []
with open(os.path.join(run_dir, "results.tsv")) as fh:
    for line in fh:
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 7:
            repo, suite, status, p, f, s, secs = parts[:7]
            rows.append(dict(repo=repo, suite=suite, status=status, passed=int(p), failed=int(f),
                             skipped=int(s), seconds=int(secs)))

commits = open(os.path.join(run_dir, "commits.txt")).read().strip() if os.path.exists(os.path.join(run_dir, "commits.txt")) else ""


def failures(repo, suite):
    """Failed test names from any JUnit file in the suite dir."""
    names = []
    d = os.path.join(run_dir, repo, suite)
    for root, _, files in os.walk(d):
        for name in files:
            if not name.endswith(".xml") or "junit" not in name.lower() and not name.startswith("TEST-"):
                continue
            try:
                for case in ET.parse(os.path.join(root, name)).getroot().iter("testcase"):
                    if case.find("failure") is not None or case.find("error") is not None:
                        names.append(f'{case.get("classname", "")}.{case.get("name", "")}'.strip("."))
            except ET.ParseError:
                pass
    return names[:25]


def artifacts(repo, suite):
    d = os.path.join(run_dir, repo, suite)
    found = []
    for root, _, files in os.walk(d):
        if ".xcresult" in root:
            continue
        for name in sorted(files):
            if name.endswith((".png", ".jpg", ".html", ".xml", ".log", ".mp4")):
                found.append(os.path.relpath(os.path.join(root, name), run_dir))
    return found


total_p = sum(r["passed"] for r in rows)
total_f = sum(r["failed"] for r in rows)
failed_suites = [r for r in rows if r["status"] == "fail"]
one_liner = (f"{len(rows) - len(failed_suites)}/{len(rows)} suites green · {total_p} tests passed · "
             f"{total_f} failed")

text = [one_liner, ""]
for r in rows:
    text.append(f'{r["status"].upper():7} {r["repo"]:8} {r["suite"]:20} passed={r["passed"]:<5} '
                f'failed={r["failed"]:<4} skipped={r["skipped"]:<4} {r["seconds"]}s')
    for name in failures(r["repo"], r["suite"]) if r["status"] == "fail" else []:
        text.append(f"          ✗ {name}")
if commits:
    text += ["", "Commits:", commits]
text += ["", f"Report: {os.path.join(run_dir, 'index.html')}"]
print("\n".join(text))

with open(os.path.join(run_dir, "summary.json"), "w") as fh:
    json.dump({"kind": kind, "suites": rows, "passed": total_p, "failed": total_f, "commits": commits}, fh, indent=2)

css = """body{font:14px -apple-system,system-ui,sans-serif;margin:24px;background:#0b1020;color:#e5e7eb}
table{border-collapse:collapse;width:100%}td,th{padding:6px 10px;border-bottom:1px solid #1f2937;text-align:left}
.pass{color:#10b981}.fail{color:#f87171}.skipped{color:#9ca3af}a{color:#a78bfa}
img{max-width:220px;margin:4px;border:1px solid #374151;border-radius:6px}pre{white-space:pre-wrap;color:#9ca3af}"""
parts = [f"<!doctype html><meta charset=utf-8><title>FitCircle CI {html.escape(kind)}</title><style>{css}</style>",
         f"<h1>FitCircle CI — {html.escape(kind)}</h1><p>{html.escape(one_liner)}</p>",
         f"<pre>{html.escape(commits)}</pre>",
         "<table><tr><th>Repo</th><th>Suite</th><th>Status</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Time</th></tr>"]
for r in rows:
    parts.append(f'<tr><td>{r["repo"]}</td><td><a href="#{r["repo"]}-{r["suite"]}">{r["suite"]}</a></td>'
                 f'<td class={r["status"]}>{r["status"]}</td><td>{r["passed"]}</td><td>{r["failed"]}</td>'
                 f'<td>{r["skipped"]}</td><td>{r["seconds"]}s</td></tr>')
parts.append("</table>")
for r in rows:
    parts.append(f'<h2 id="{r["repo"]}-{r["suite"]}">{r["repo"]} / {r["suite"]} '
                 f'<span class={r["status"]}>{r["status"]}</span></h2>')
    fails = failures(r["repo"], r["suite"])
    if fails:
        parts.append("<ul>" + "".join(f"<li class=fail>{html.escape(n)}</li>" for n in fails) + "</ul>")
    files = artifacts(r["repo"], r["suite"])
    imgs = [f for f in files if f.endswith((".png", ".jpg"))][:60]
    others = [f for f in files if not f.endswith((".png", ".jpg"))][:40]
    parts.append("<p>" + " · ".join(f'<a href="{html.escape(f)}">{html.escape(os.path.basename(f))}</a>' for f in others) + "</p>")
    parts.append("".join(f'<a href="{html.escape(f)}"><img src="{html.escape(f)}" loading=lazy></a>' for f in imgs))
with open(os.path.join(run_dir, "index.html"), "w") as fh:
    fh.write("\n".join(parts))
