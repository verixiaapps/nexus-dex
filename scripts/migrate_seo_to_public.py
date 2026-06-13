#!/usr/bin/env python3
"""
migrate_seo_to_public.py

One-time migration script.

WHAT IT DOES
------------
1. Walks every defi/<slug>/index.html in the repo.
2. Rewrites two URL patterns inside each file:
     https://verixiaapps.com/nexus-dex/defi/   ->   https://swap.verixiaapps.com/
     /nexus-dex/defi/                          ->   /
   That covers canonical, og:url, JSON-LD url, breadcrumb item URLs, and
   internal <a href="..."> links between pages.
3. Writes the rewritten HTML to public/<slug>/index.html.
4. Rebuilds nexus-sitemap.xml at the repo root with swap.v URLs by scanning
   public/ on disk (so the sitemap reflects exactly what was migrated).

WHAT IT DOES NOT TOUCH
----------------------
- The original defi/ tree. Files there are left in place. Delete them manually
  after the migration is verified.
- https://verixiaapps.com/nexus-dex/verixia-wc.js (cross-origin wallet bundle).
- https://verixiaapps.com/og/nexus-dex.png (parent brand og image).
- https://verixiaapps.com/nexus-dex/images/animehero.webp (parent brand asset).
- "isPartOf" / "publisher" JSON-LD blocks pointing at https://verixiaapps.com/
  (parent brand references — intentionally kept).

Run from the repo root: python scripts/migrate_seo_to_public.py
Or via the migrate-seo-to-public GH Action (workflow_dispatch).
"""

import os
import subprocess
from datetime import datetime, timezone

BASE_DIR     = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC_DIR      = os.path.join(BASE_DIR, "defi")
DST_DIR      = os.path.join(BASE_DIR, "public")
SITEMAP_FILE = os.path.join(BASE_DIR, "nexus-sitemap.xml")
SWAP_SITE    = "https://swap.verixiaapps.com"

# IMPORTANT: do the absolute-URL replacement FIRST so the path replacement
# doesn't accidentally chew up the inside of the full URL.
OLD_FULL_URL_PREFIX = "https://verixiaapps.com/nexus-dex/defi/"
NEW_FULL_URL_PREFIX = "https://swap.verixiaapps.com/"
OLD_PATH_PREFIX     = "/nexus-dex/defi/"
NEW_PATH_PREFIX     = "/"

# Files in public/ that already exist and should never be overwritten.
# These are the CRA-managed entries (the SPA shell + assets). The slugs we
# generate via SEO pipeline will never collide with these names in practice,
# but we explicitly guard against it.
RESERVED_NAMES = {
    "index.html",
    "favicon.ico",
    "manifest.json",
    "robots.txt",
    "asset-manifest.json",
    "logo192.png",
    "logo512.png",
}


def rewrite_html(html):
    """Apply the two URL rewrites. Order matters."""
    html = html.replace(OLD_FULL_URL_PREFIX, NEW_FULL_URL_PREFIX)
    html = html.replace(OLD_PATH_PREFIX, NEW_PATH_PREFIX)
    return html


def migrate_pages():
    if not os.path.isdir(SRC_DIR):
        print(f"[migrate] Source directory not found: {SRC_DIR}")
        return 0

    os.makedirs(DST_DIR, exist_ok=True)

    migrated = 0
    skipped_reserved = 0

    for entry in sorted(os.listdir(SRC_DIR)):
        if entry in RESERVED_NAMES:
            skipped_reserved += 1
            print(f"[migrate] Skipping reserved name collision: {entry}")
            continue

        src_dir  = os.path.join(SRC_DIR, entry)
        src_file = os.path.join(src_dir, "index.html")
        if not os.path.isdir(src_dir) or not os.path.isfile(src_file):
            continue

        dst_dir  = os.path.join(DST_DIR, entry)
        dst_file = os.path.join(dst_dir, "index.html")

        with open(src_file, "r", encoding="utf-8") as f:
            html = f.read()

        new_html = rewrite_html(html)

        os.makedirs(dst_dir, exist_ok=True)
        with open(dst_file, "w", encoding="utf-8") as f:
            f.write(new_html)

        migrated += 1
        if migrated % 50 == 0:
            print(f"[migrate] {migrated} pages so far...")

    print(f"[migrate] Done. Migrated {migrated} pages to public/")
    if skipped_reserved:
        print(f"[migrate] Skipped {skipped_reserved} reserved-name collisions.")
    return migrated


def git_lastmod_for(file_path):
    """Last commit date for file_path (YYYY-MM-DD), or today UTC if unknown."""
    try:
        r = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", file_path],
            capture_output=True, text=True, check=False,
        )
        date_str = (r.stdout or "").strip()
        if date_str:
            return date_str
    except Exception:
        pass
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def rebuild_sitemap():
    """Rebuild nexus-sitemap.xml by scanning public/ on disk."""
    urls = []
    if os.path.isdir(DST_DIR):
        for entry in sorted(os.listdir(DST_DIR)):
            if entry in RESERVED_NAMES:
                continue
            dir_path   = os.path.join(DST_DIR, entry)
            index_path = os.path.join(dir_path, "index.html")
            if not os.path.isdir(dir_path) or not os.path.isfile(index_path):
                continue
            lastmod = git_lastmod_for(index_path)
            urls.append(
                f"<url><loc>{SWAP_SITE}/{entry}/</loc><lastmod>{lastmod}</lastmod></url>"
            )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ("\n".join(urls) + "\n" if urls else "")
        + '</urlset>\n'
    )
    with open(SITEMAP_FILE, "w", encoding="utf-8") as f:
        f.write(xml)
    print(f"[sitemap] Wrote {len(urls)} URLs to nexus-sitemap.xml")


def main():
    print("[migrate] Starting SEO page migration: defi/ -> public/ (swap.v)")
    migrate_pages()
    rebuild_sitemap()
    print("[migrate] Complete.")


if __name__ == "__main__":
    main()
