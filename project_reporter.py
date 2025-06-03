#!/usr/bin/env python3
import os
from pathlib import Path

# CONFIGURATION
# - Paths (directories or filenames) to exclude
# - File extensions to exclude
# - Output file name or relative path within the parent directory
CONFIG = {
    "exclude_paths": ["node_modules", "__pycache__", ".git", "ignore_this_file.txt",
    ".DS_Store", ".idea", "data", "_archive", "links", "links/tags", "objects", '.git'],
    "exclude_extensions": [".pyc", ".log", ".DS_Store", ".env", ".example", ".json"],
    "exclude_files": ["secrets.txt", "draft.md", "index.js", ".env", ".gitignore", ".git"],
    "output_file": "file_contents_report.txt"
}

def should_exclude(file_path: Path, script_path: Path, parent_dir: Path) -> bool:
    """
    Determine if a file should be excluded based on:
    - Being the script itself
    - Matching configured exclude paths
    - Matching configured exclude extensions
    """
    # Exclude the running script
    if file_path.resolve() == script_path:
        return True

    # Exclude by extension
    if file_path.suffix in CONFIG["exclude_extensions"]:
        return True

    # Exclude by exact filename
    if file_path.name in CONFIG["exclude_files"]:
        return True

    # Exclude if any part of the relative path matches an excluded path
    rel_parts = file_path.relative_to(parent_dir).parts
    if any(part in CONFIG["exclude_paths"] for part in rel_parts):
        return True

    return False

def write_directory_structure(parent_dir: Path, out_file, item_limit=10):
    """
    Write a full directory structure (no exclusions) to the output file.
    If a directory has more than `item_limit` entries, summarize instead of listing.
    """
    script_path = Path(__file__).resolve()
    out_file.write("FULL DIRECTORY STRUCTURE\n")
    out_file.write("========================\n\n")

    # List files in the root directory (excluding excluded items)
    try:
        raw_root_children = sorted(parent_dir.iterdir())
        root_files = [
            child for child in raw_root_children
            if child.is_file() and not should_exclude(child, script_path, parent_dir)
        ]
        for root_file in root_files:
            out_file.write(f"{root_file.name}\n")
    except Exception:
        pass

    for path in sorted(parent_dir.rglob("*")):
        if should_exclude(path, script_path, parent_dir):
            continue
        rel_path = path.relative_to(parent_dir)
        indent_level = len(rel_path.parents) - 1
        indent = "    " * indent_level

        if path.is_dir():
            out_file.write(f"{indent}{rel_path.name}/\n")

            # Check contents of this dir
            try:
                raw_children = sorted(path.iterdir())
                children = [child for child in raw_children if not should_exclude(child, script_path, parent_dir)]
            except Exception:
                continue  # Skip unreadable dirs

            if len(children) > item_limit:
                out_file.write(f"{indent}    (directory contains {len(children)} items)\n")
            else:
                for child in children:
                    child_entry = f"{child.name}/" if child.is_dir() else child.name
                    out_file.write(f"{indent}    {child_entry}\n")
        # (don’t list files here—those are shown as children of parent dirs)

    out_file.write("\n\n")

def main():
    # Resolve paths
    script_path = Path(__file__).resolve()
    parent_dir = script_path.parent

    # Determine output file path
    output_path = parent_dir / CONFIG["output_file"]

    with output_path.open("w", encoding="utf-8") as out_file:
        # Walk through all files in the parent directory recursively
        for file_path in parent_dir.rglob("*"):
            if not file_path.is_file():
                continue
            if should_exclude(file_path, script_path, parent_dir):
                continue

            # Write header with relative path
            rel_path = file_path.relative_to(parent_dir)
            header = f"{rel_path}\n{'-' * len(str(rel_path))}\n"
            out_file.write(header)

            # Write file contents
            try:
                content = file_path.read_text(encoding="utf-8")
            except Exception:
                # Skip unreadable files silently
                continue
            out_file.write(content + "\n\n")

        # After writing file contents, append full directory structure
        write_directory_structure(parent_dir, out_file)

    print(f"Aggregation complete. Output written to: {output_path}")

if __name__ == "__main__":
    main()