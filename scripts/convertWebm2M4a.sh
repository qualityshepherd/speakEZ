#!/usr/bin/env bash
# convertWebm2M4a.sh — convert speakEZ session recordings to Logic-ready M4A
# Usage: ./convertWebm2M4a.sh [directory]
# Default directory: .

INPUT_DIR="."

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

shopt -s nullglob
files=("$INPUT_DIR"/speakez-*.webm)

if [ ${#files[@]} -eq 0 ]; then
  echo "No speakez-*.webm files found in $INPUT_DIR"
  exit 0
fi

echo "Found ${#files[@]} file(s) in $INPUT_DIR"
echo ""

for f in "${files[@]}"; do
  out="${f%.webm}.m4a"
  if [ -f "$out" ]; then
    echo "Skipping (already exists): $(basename "$out")"
    continue
  fi
  echo "Converting: $(basename "$f")"
  ffmpeg -i "$f" -c:a aac -b:a 320k -ar 48000 "$out" -loglevel error
  if [ $? -eq 0 ]; then
    echo "  → $(basename "$out")"
  else
    echo "  ✗ Failed: $(basename "$f")"
  fi
done

echo ""
echo "Done."
