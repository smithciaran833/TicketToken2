#!/bin/bash
echo "Adding placeholder content to empty files..."
find . -name "*.js" -type f -empty -exec sh -c 'echo "// TODO: Implement $(basename "$1")" > "$1"' _ {} \;
find . -name "*.json" -type f -empty -exec sh -c 'echo "{}" > "$1"' _ {} \;
find . -name "*.md" -type f -empty -exec sh -c 'echo "# $(basename "$1" .md)" > "$1"' _ {} \;
find . -type d -empty -exec touch {}/.gitkeep \;
echo "Done! All empty files now have placeholder content."
