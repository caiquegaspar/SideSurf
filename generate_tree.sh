#!/usr/bin/env bash
# generate_tree.sh — Directory tree generator with .gitignore support
# Usage: ./generate_tree.sh [options]
# See --help for full usage.

set -euo pipefail
shopt -s nullglob dotglob   # nullglob: empty glob → nothing; dotglob: include dotfiles in *

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
readonly DEFAULT_TXT_OUTPUT="project_structure.txt"
readonly DEFAULT_MD_OUTPUT="project_structure.md"

# Binary-file extensions to skip when printing content
readonly -a BINARY_EXTENSIONS=(
  jpg jpeg png gif bmp svg ico webp tiff tif
  mp3 mp4 wav ogg flac avi mov mkv
  zip tar gz bz2 xz 7z rar
  pdf doc docx xls xlsx ppt pptx
  exe bin dll so dylib a o
  db sqlite sqlite3
  woff woff2 ttf eot
  pyc pyo class
)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
DEBUG_MODE=false
PRINT_CONTENT=false
MAX_DEPTH=0               # 0 = unlimited
OUTPUT_FILE=""            # resolved in main()
ignored_patterns=()
content_skip_patterns=()  # visible in tree but excluded from --print-content
collected_files=()        # populated during tree walk; reused for content section

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
debug_echo() {
  [[ "$DEBUG_MODE" == true ]] && printf '[DEBUG] %s\n' "$*" >&2 || true
}

err() {
  printf '%s: error: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: generate_tree.sh [OPTIONS]

Generate a directory tree, respecting .gitignore and .generatetreeignore.

Options:
  -o, --output FILE       Write output to FILE instead of the default name.
                            Default for --txt : project_structure.txt
                            Default for --md  : project_structure.md
      --txt               Output as plain text (default).
      --md                Output as Markdown with syntax-highlighted file content.
      --print-content     Append file contents to the output.
                          Binary files are detected and skipped automatically.
      --skip-content PAT  Show files matching PAT in the tree but omit their
                          content from --print-content. Can be repeated.
                          Same glob syntax as .gitignore.
                          E.g.: --skip-content "*.lock" --skip-content "*.json"
      --max-depth N       Limit directory recursion to N levels (0 = unlimited).
  -d, --debug             Print debug messages to stderr during execution.
  -h, --help              Show this message and exit.

Ignore files:
  .gitignore              Standard Git ignore rules (loaded automatically).
  .generatetreeignore     Additional tree-ignore patterns (same syntax).
  .contentignore          Files listed here appear in the tree but their
                          contents are never printed by --print-content.
                          Useful for lock files, large generated files, etc.

The output file and this script are always excluded from the tree.

Examples:
  generate_tree.sh
  generate_tree.sh --md --print-content
  generate_tree.sh --md --print-content --skip-content "*.lock"
  generate_tree.sh --txt --max-depth 3 -o tree.txt
  generate_tree.sh --md -o docs/structure.md
EOF
}

# ---------------------------------------------------------------------------
# Ignore-pattern loading & matching
# ---------------------------------------------------------------------------
load_ignore_patterns() {
  ignored_patterns+=(".git/")

  local f line
  for f in ".gitignore" ".generatetreeignore"; do
    [[ -f "$f" ]] || continue
    debug_echo "Loading tree-ignore patterns from $f"
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%%#*}"
      line="${line#"${line%%[^[:space:]]*}"}"   # ltrim
      line="${line%"${line##*[^[:space:]]}"}"   # rtrim
      [[ -n "$line" ]] && ignored_patterns+=("$line")
    done < "$f"
  done

  # Load content-skip patterns from .contentignore (visible in tree, hidden from content)
  if [[ -f ".contentignore" ]]; then
    debug_echo "Loading content-skip patterns from .contentignore"
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%%#*}"
      line="${line#"${line%%[^[:space:]]*}"}"
      line="${line%"${line##*[^[:space:]]}"}"
      [[ -n "$line" ]] && content_skip_patterns+=("$line")
    done < ".contentignore"
  fi

  debug_echo "Loaded ${#ignored_patterns[@]} tree-ignore pattern(s): ${ignored_patterns[*]}"
  debug_echo "Loaded ${#content_skip_patterns[@]} content-skip pattern(s): ${content_skip_patterns[*]:-none}"
}

is_ignored() {
  local entry="$1"
  [[ -d "$entry" ]] && entry="${entry%/}/"

  debug_echo "Checking: '$entry'"
  local pattern
  for pattern in "${ignored_patterns[@]}"; do
    # $pattern unquoted intentionally to allow glob expansion (e.g. *.log)
    # shellcheck disable=SC2254
    if [[ "$entry" == $pattern      || \
          "$entry" == */"$pattern"  || \
          "$entry" == "$pattern"/*  ]]; then
      debug_echo "  ignored by '$pattern'"
      return 0
    fi
  done
  return 1
}

# Returns 0 if the file should be shown in the tree but its content suppressed.
is_content_skipped() {
  local file="$1"
  local pattern
  for pattern in "${content_skip_patterns[@]}"; do
    # shellcheck disable=SC2254
    if [[ "$file" == $pattern     || \
          "$file" == */"$pattern" ]]; then
      debug_echo "  content-skipped by '$pattern'"
      return 0
    fi
  done
  return 1
}

is_binary_file() {
  local file="$1"
  local ext="${file##*.}"
  ext="${ext,,}"   # to lowercase (requires bash 4+)
  local e
  for e in "${BINARY_EXTENSIONS[@]}"; do
    [[ "$ext" == "$e" ]] && return 0
  done
  # Fallback: ask 'file' command if available
  if command -v file &>/dev/null; then
    file --brief --mime-encoding "$file" 2>/dev/null | grep -q 'binary' && return 0 || true
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Extension → Markdown language identifier
# ---------------------------------------------------------------------------
md_lang_for_file() {
  local ext="${1##*.}"
  ext="${ext,,}"
  case "$ext" in
    sh|bash)         printf 'bash'       ;;
    py)              printf 'python'     ;;
    js|mjs|cjs)      printf 'javascript' ;;
    ts|tsx)          printf 'typescript' ;;
    jsx)             printf 'jsx'        ;;
    json|jsonc)      printf 'json'       ;;
    yaml|yml)        printf 'yaml'       ;;
    toml)            printf 'toml'       ;;
    md|markdown)     printf 'markdown'   ;;
    html|htm)        printf 'html'       ;;
    css|scss|sass)   printf 'css'        ;;
    sql)             printf 'sql'        ;;
    go)              printf 'go'         ;;
    rs)              printf 'rust'       ;;
    java)            printf 'java'       ;;
    c|h)             printf 'c'          ;;
    cpp|cc|cxx|hpp)  printf 'cpp'        ;;
    rb)              printf 'ruby'       ;;
    php)             printf 'php'        ;;
    swift)           printf 'swift'      ;;
    kt|kts)          printf 'kotlin'     ;;
    dockerfile)      printf 'dockerfile' ;;
    xml)             printf 'xml'        ;;
    tf|tfvars)       printf 'hcl'        ;;
    *)               printf ''           ;;
  esac
}

# ---------------------------------------------------------------------------
# Tree generation
# ---------------------------------------------------------------------------
# generate_tree_structure DIR INDENT [DEPTH]
# Prints the tree to stdout. Populates global array `collected_files`.
generate_tree_structure() {
  local dir="$1"
  local indent="$2"
  local current_depth="${3:-0}"

  if (( MAX_DEPTH > 0 && current_depth >= MAX_DEPTH )); then
    return
  fi

  local entry relative_path
  local dirs=() files=()

  # With dotglob active, "$dir"/* already includes hidden entries.
  for entry in "$dir"/*; do
    [[ -e "$entry" ]] || continue
    local base="${entry##*/}"
    [[ "$base" == "."  ]] && continue
    [[ "$base" == ".." ]] && continue

    relative_path="${entry#./}"
    is_ignored "$relative_path" && continue

    if [[ -d "$entry" ]]; then
      dirs+=("$entry")
    else
      files+=("$entry")
      collected_files+=("$relative_path")
    fi
  done

  (( ${#dirs[@]}  > 0 )) && mapfile -t dirs  < <(printf '%s\n' "${dirs[@]}"  | sort)
  (( ${#files[@]} > 0 )) && mapfile -t files < <(printf '%s\n' "${files[@]}" | sort)

  local total=$(( ${#dirs[@]} + ${#files[@]} ))
  local idx=0
  local name prefix connector

  for entry in "${dirs[@]}"; do
    name="${entry##*/}"
    idx=$(( idx + 1 ))
    if (( idx < total )); then
      prefix="├── "; connector="│   "
    else
      prefix="└── "; connector="    "
    fi
    printf '%s%s%s/\n' "$indent" "$prefix" "$name"
    generate_tree_structure "$entry" "${indent}${connector}" "$(( current_depth + 1 ))"
  done

  for entry in "${files[@]}"; do
    name="${entry##*/}"
    idx=$(( idx + 1 ))
    [[ $idx -lt $total ]] && prefix="├── " || prefix="└── "
    printf '%s%s%s\n' "$indent" "$prefix" "$name"
  done
}

# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------
write_txt() {
  local out="$1"
  : > "$out"

  {
    printf '%s\n\n' "--- Project Structure ---"
    printf '/\n'
    generate_tree_structure "." ""
  } >> "$out"

  if [[ "$PRINT_CONTENT" == true ]]; then
    {
      printf '\n%s\n' "--- File Contents ---"
      local f
      for f in "${collected_files[@]}"; do
        printf '\n--- File: %s ---\n\n' "$f"
        if is_binary_file "$f"; then
          printf '[binary file - skipped]\n'
        elif is_content_skipped "$f"; then
          printf '[skipped by --skip-content]\n'
        else
          cat "$f" 2>/dev/null || printf '[error reading file]\n'
        fi
        printf '\n'
      done
    } >> "$out"
  fi
}

write_md() {
  local out="$1"
  : > "$out"

  {
    printf '# Project Structure\n\n'
    printf '```\n'
    printf '/\n'
    generate_tree_structure "." ""
    printf '```\n'
  } >> "$out"

  if [[ "$PRINT_CONTENT" == true ]]; then
    {
      printf '\n---\n\n# File Contents\n'
      local f lang
      for f in "${collected_files[@]}"; do
        printf '\n## `%s`\n\n' "$f"
        if is_binary_file "$f"; then
          printf '_Binary file - skipped._\n'
        elif is_content_skipped "$f"; then
          printf '_Skipped by --skip-content._\n'
        else
          lang="$(md_lang_for_file "$f")"
          printf '```%s\n' "$lang"
          cat "$f" 2>/dev/null || printf '[error reading file]'
          printf '\n```\n'
        fi
      done
    } >> "$out"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local output_format="txt"
  local custom_output=""

  while (( $# > 0 )); do
    case "$1" in
      --help|-h)
        usage; exit 0 ;;
      --debug|-d)
        DEBUG_MODE=true ;;
      --print-content)
        PRINT_CONTENT=true ;;
      --md)
        output_format="md" ;;
      --txt)
        output_format="txt" ;;
      --skip-content)
        [[ -n "${2:-}" ]] || err "--skip-content requires a pattern argument"
        content_skip_patterns+=("$2"); shift ;;
      --skip-content=*)
        content_skip_patterns+=("${1#*=}") ;;
      --max-depth)
        [[ -n "${2:-}" ]] || err "--max-depth requires a numeric argument"
        [[ "$2" =~ ^[0-9]+$ ]] || err "--max-depth must be a non-negative integer"
        MAX_DEPTH="$2"; shift ;;
      --max-depth=*)
        MAX_DEPTH="${1#*=}"
        [[ "$MAX_DEPTH" =~ ^[0-9]+$ ]] || err "--max-depth must be a non-negative integer" ;;
      --output|-o)
        [[ -n "${2:-}" ]] || err "--output requires a filename"
        custom_output="$2"; shift ;;
      --output=*)
        custom_output="${1#*=}" ;;
      -*)
        err "unknown option: $1  (run with --help for usage)" ;;
      *)
        err "unexpected argument: $1  (run with --help for usage)" ;;
    esac
    shift
  done

  if [[ -n "$custom_output" ]]; then
    OUTPUT_FILE="$custom_output"
  elif [[ "$output_format" == "md" ]]; then
    OUTPUT_FILE="$DEFAULT_MD_OUTPUT"
  else
    OUTPUT_FILE="$DEFAULT_TXT_OUTPUT"
  fi

  ignored_patterns+=("${OUTPUT_FILE##*/}" "$SCRIPT_NAME")

  load_ignore_patterns

  debug_echo "Output format  : $output_format"
  debug_echo "Output file    : $OUTPUT_FILE"
  debug_echo "Print content  : $PRINT_CONTENT"
  debug_echo "Skip content   : ${content_skip_patterns[*]:-none}"
  debug_echo "Max depth      : $MAX_DEPTH (0=unlimited)"

  if [[ "$output_format" == "md" ]]; then
    write_md "$OUTPUT_FILE"
  else
    write_txt "$OUTPUT_FILE"
  fi

  printf 'Output written to: %s\n' "$OUTPUT_FILE"
}

main "$@"