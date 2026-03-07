#!/usr/bin/env python3
"""
Sync script: Crawls a public Google Drive folder and generates resources.json.

Usage:
    python sync_drive.py --folder-id <FOLDER_ID> --api-key <API_KEY> --output <PATH>

The script recursively lists all files, extracts metadata (name, type, size,
modified date, folder path as category breadcrumb), and writes a JSON catalog
that the static site consumes.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode


API_BASE = "https://www.googleapis.com/drive/v3"

# Map MIME types to human-friendly labels
MIME_LABELS = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.folder": "Folder",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "video/mp4": "MP4",
}

# File extensions to include (empty = include all non-folder files)
SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls",
    ".png", ".jpg", ".jpeg", ".mp4", ".txt", ".csv",
}


def api_get(endpoint, params, api_key, retries=3):
    """Make a GET request to the Google Drive API with retry logic."""
    params["key"] = api_key
    url = f"{API_BASE}/{endpoint}?{urlencode(params)}"
    for attempt in range(retries):
        try:
            req = Request(url)
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = 2 ** (attempt + 1)
                print(f"  Retrying in {wait}s (HTTP {e.code})...")
                time.sleep(wait)
                continue
            raise
        except URLError:
            wait = 2 ** (attempt + 1)
            print(f"  Network error, retrying in {wait}s...")
            time.sleep(wait)
            continue
    print(f"  Failed after {retries} retries: {endpoint}")
    return None


def list_files_in_folder(folder_id, api_key):
    """List all files/folders in a single Drive folder (handles pagination)."""
    items = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink)",
            "pageSize": "1000",
            "orderBy": "name",
        }
        if page_token:
            params["pageToken"] = page_token
        data = api_get("files", params, api_key)
        if data is None:
            break
        items.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return items


def crawl_folder(folder_id, api_key, path_parts=None):
    """Recursively crawl a Google Drive folder tree.

    Yields (file_metadata_dict, category_path_list) tuples for each file.
    """
    if path_parts is None:
        path_parts = []

    items = list_files_in_folder(folder_id, api_key)
    print(f"  {'/' .join(path_parts) or '(root)'}: {len(items)} items")

    for item in items:
        if item["mimeType"] == "application/vnd.google-apps.folder":
            yield from crawl_folder(item["id"], api_key, path_parts + [item["name"]])
        else:
            yield item, path_parts


def file_extension(name):
    """Extract lowercase file extension."""
    _, ext = os.path.splitext(name)
    return ext.lower()


def build_resource_entry(file_meta, category_path):
    """Convert a Drive file item into a resource catalog entry."""
    name = file_meta["name"]
    mime = file_meta.get("mimeType", "")
    ext = file_extension(name)

    # Determine the best link: direct download for binary files, web view for Google-native
    if mime.startswith("application/vnd.google-apps."):
        link = file_meta.get("webViewLink", "")
        download_link = ""
    else:
        link = file_meta.get("webViewLink", "")
        download_link = file_meta.get("webContentLink", "")

    # Derive category from first folder level, subcategory from second
    category = category_path[0] if len(category_path) > 0 else "Uncategorized"
    subcategory = category_path[1] if len(category_path) > 1 else ""

    # Try to detect language from folder names or filename
    language = detect_language(name, category_path)

    return {
        "id": file_meta["id"],
        "name": name,
        "type": MIME_LABELS.get(mime, ext.upper().lstrip(".") or "File"),
        "mimeType": mime,
        "category": category,
        "subcategory": subcategory,
        "path": "/".join(category_path),
        "language": language,
        "size": int(file_meta.get("size", 0)),
        "modifiedTime": file_meta.get("modifiedTime", ""),
        "link": link,
        "downloadLink": download_link,
    }


LANGUAGE_KEYWORDS = {
    "french": "French",
    "francais": "French",
    "français": "French",
    "english": "English",
    "spanish": "Spanish",
    "español": "Spanish",
    "swahili": "Swahili",
    "kiswahili": "Swahili",
    "portuguese": "Portuguese",
    "kinyarwanda": "Kinyarwanda",
    "amharic": "Amharic",
}


def detect_language(filename, path_parts):
    """Best-effort language detection from folder names and filename."""
    text = " ".join(path_parts + [filename]).lower()
    for keyword, language in LANGUAGE_KEYWORDS.items():
        if keyword in text:
            return language
    return "English"  # default assumption


def build_catalog(folder_id, api_key):
    """Crawl the entire Drive folder and return the full catalog dict."""
    print(f"Crawling folder: {folder_id}")
    resources = []
    for file_meta, category_path in crawl_folder(folder_id, api_key):
        entry = build_resource_entry(file_meta, category_path)
        resources.append(entry)

    # Sort by category then name
    resources.sort(key=lambda r: (r["category"], r["name"]))

    # Build summary metadata
    categories = sorted(set(r["category"] for r in resources))
    types = sorted(set(r["type"] for r in resources))
    languages = sorted(set(r["language"] for r in resources))

    catalog = {
        "lastSync": datetime.now(timezone.utc).isoformat(),
        "totalFiles": len(resources),
        "categories": categories,
        "types": types,
        "languages": languages,
        "resources": resources,
    }
    return catalog


def main():
    parser = argparse.ArgumentParser(description="Sync Google Drive folder to resources.json")
    parser.add_argument("--folder-id", required=True, help="Google Drive folder ID")
    parser.add_argument("--api-key", required=True, help="Google API key (with Drive API enabled)")
    parser.add_argument(
        "--output",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "resources.json"),
        help="Output path for resources.json",
    )
    args = parser.parse_args()

    catalog = build_catalog(args.folder_id, args.api_key)

    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"\nDone! {catalog['totalFiles']} resources written to {args.output}")
    print(f"Categories: {', '.join(catalog['categories'])}")
    print(f"Types: {', '.join(catalog['types'])}")
    print(f"Languages: {', '.join(catalog['languages'])}")


if __name__ == "__main__":
    main()
