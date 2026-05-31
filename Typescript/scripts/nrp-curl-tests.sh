#!/usr/bin/env bash
set -u

ROOT_HOST_DEFAULT="$(hostname | tr '[:upper:]' '[:lower:]')"
case "$ROOT_HOST_DEFAULT" in
  *.local) ;;
  *) ROOT_HOST_DEFAULT="${ROOT_HOST_DEFAULT}.local" ;;
esac

SCHEME="${NRP_SCHEME:-https}"
ROOT_HOST="${NRP_HOST:-$ROOT_HOST_DEFAULT}"
HANDLE="${NRP_HANDLE:-fatima}"
TIMEOUT="${NRP_TIMEOUT:-8}"
RESOLVE_LOCAL="${NRP_RESOLVE_LOCAL:-1}"
SHOW_BODY_ON_PASS="${NRP_SHOW_BODY_ON_PASS:-0}"

if [[ "$SCHEME" == "https" ]]; then
  PORT="${NRP_PORT:-443}"
else
  PORT="${NRP_PORT:-80}"
fi

BASE_URL="${SCHEME}://${ROOT_HOST}"
HANDLE_HOST="${HANDLE}.${ROOT_HOST}"
HANDLE_BASE_URL="${SCHEME}://${HANDLE_HOST}"

CURL_ARGS=(--silent --show-error --location --max-time "$TIMEOUT")
if [[ "$SCHEME" == "https" ]]; then
  CURL_ARGS+=(--insecure)
fi
if [[ "$RESOLVE_LOCAL" == "1" ]]; then
  CURL_ARGS+=(--resolve "${ROOT_HOST}:${PORT}:127.0.0.1")
  CURL_ARGS+=(--resolve "${HANDLE_HOST}:${PORT}:127.0.0.1")
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nrp-curl-tests.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

pass_count=0
fail_count=0
REQUEST_BODY=""

print_header() {
  printf '\nNRP curl contract tests\n'
  printf '  base:          %s\n' "$BASE_URL"
  printf '  handle:        %s\n' "$HANDLE"
  printf '  handle host:   %s\n' "$HANDLE_BASE_URL"
  printf '  resolve local: %s\n' "$RESOLVE_LOCAL"
  printf '\n'
}

pass() {
  pass_count=$((pass_count + 1))
  printf 'PASS  %s\n' "$1"
}

fail() {
  fail_count=$((fail_count + 1))
  printf 'FAIL  %s\n' "$1"
  if [[ -n "${2:-}" ]]; then
    printf '      %s\n' "$2"
  fi
}

request() {
  local label="$1"
  local url="$2"
  local accept="$3"
  local body="$TMP_DIR/${label//[^a-zA-Z0-9]/_}.body"
  local headers="$TMP_DIR/${label//[^a-zA-Z0-9]/_}.headers"
  local status

  status="$(curl "${CURL_ARGS[@]}" \
    -H "Accept: ${accept}" \
    -D "$headers" \
    -o "$body" \
    -w "%{http_code}" \
    "$url" 2>"$TMP_DIR/${label//[^a-zA-Z0-9]/_}.err")"
  local exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    fail "$label" "curl failed: $(cat "$TMP_DIR/${label//[^a-zA-Z0-9]/_}.err")"
    return 1
  fi

  printf '%s\n' "$status" > "$TMP_DIR/${label//[^a-zA-Z0-9]/_}.status"
  REQUEST_BODY="$body"
}

content_type_for() {
  local body="$1"
  local headers="${body%.body}.headers"
  awk 'BEGIN{IGNORECASE=1} /^content-type:/ { sub(/\r$/, ""); print; exit }' "$headers"
}

header_for() {
  local body="$1"
  local header_name="$2"
  local headers="${body%.body}.headers"
  awk -v name="$header_name" '
    BEGIN { IGNORECASE=1 }
    {
      line=$0
      sub(/\r$/, "", line)
      if (tolower(line) ~ "^" tolower(name) ":") {
        sub("^[^:]+:[[:space:]]*", "", line)
        print line
      }
    }
  ' "$headers"
}

status_for() {
  local body="$1"
  cat "${body%.body}.status"
}

preview_body() {
  local body="$1"
  tr '\n' ' ' < "$body" | cut -c 1-260
}

assert_2xx() {
  local label="$1"
  local body="$2"
  local status
  status="$(status_for "$body")"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    return 0
  fi
  fail "$label" "expected HTTP 2xx, got ${status}; body: $(preview_body "$body")"
  return 1
}

assert_nrp_api_status() {
  local label="$1"
  local body="$2"
  local status
  status="$(status_for "$body")"
  if [[ "$status" =~ ^2[0-9][0-9]$ || "$status" == "404" ]]; then
    return 0
  fi
  fail "$label" "expected HTTP 2xx or JSON 404 for absent value, got ${status}; body: $(preview_body "$body")"
  return 1
}

assert_html() {
  local label="$1"
  local body="$2"
  local ct
  ct="$(content_type_for "$body")"
  if grep -qiE 'text/html' <<< "$ct" || head -c 120 "$body" | grep -qiE '<!doctype html|<html'; then
    if [[ "$SHOW_BODY_ON_PASS" == "1" ]]; then
      printf '      %s\n' "$(preview_body "$body")"
    fi
    pass "$label"
    return 0
  fi
  fail "$label" "expected HTML navigation response, got ${ct:-no content-type}; body: $(preview_body "$body")"
  return 1
}

assert_json() {
  local label="$1"
  local body="$2"
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$body" >/dev/null 2>&1; then
    if [[ "$SHOW_BODY_ON_PASS" == "1" ]]; then
      printf '      %s\n' "$(preview_body "$body")"
    fi
    pass "$label"
    return 0
  fi
  fail "$label" "expected JSON API response; content-type: $(content_type_for "$body"); body: $(preview_body "$body")"
  return 1
}

assert_header_contains() {
  local label="$1"
  local body="$2"
  local header_name="$3"
  local expected="$4"
  local value
  value="$(header_for "$body" "$header_name" | tr '\n' ',')"
  if grep -qi -- "$expected" <<< "$value"; then
    pass "$label"
    return 0
  fi
  fail "$label" "expected ${header_name} to contain ${expected}; got ${value:-missing}"
  return 1
}

assert_nrp_cache_contract() {
  local label="$1"
  local body="$2"
  assert_header_contains "$label Vary" "$body" "Vary" "Accept" || return 1
  assert_header_contains "$label Cache-Control" "$body" "Cache-Control" "no-store" || return 1
}

assert_nrp_target() {
  local label="$1"
  local body="$2"
  local expected_namespace="$3"
  local expected_path="$4"

  local detail
  detail="$(node - "$body" "$expected_namespace" "$expected_path" <<'NODE'
const fs = require('fs');
const [bodyPath, expectedNamespace, expectedPath] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
const target = payload.target || {};
const namespace = String(target.namespace?.me || payload.namespace || '');
const operation = String(target.operation || payload.operation || '');
const path = String(target.path || payload.path || '');
const ok = payload.ok === true || Boolean(target.namespace);

const errors = [];
if (!ok) errors.push('payload.ok is not true and target.namespace is missing');
if (namespace !== expectedNamespace) errors.push(`namespace ${JSON.stringify(namespace)} !== ${JSON.stringify(expectedNamespace)}`);
if (operation && operation !== 'read') errors.push(`operation ${JSON.stringify(operation)} !== "read"`);
if (path !== expectedPath) errors.push(`path ${JSON.stringify(path)} !== ${JSON.stringify(expectedPath)}`);

if (errors.length) {
  console.error(errors.join('; '));
  process.exit(1);
}
NODE
  )"
  local exit_code=$?
  if [[ "$exit_code" -eq 0 ]]; then
    pass "$label"
    return 0
  fi
  fail "$label" "${detail}; body: $(preview_body "$body")"
  return 1
}

run_html_test() {
  local label="$1"
  local url="$2"
  local body
  request "$label" "$url" "text/html,application/xhtml+xml" || return 0
  body="$REQUEST_BODY"
  assert_2xx "$label" "$body" || return 0
  assert_html "$label" "$body" || return 0
  assert_nrp_cache_contract "$label" "$body" || return 0
}

run_json_test() {
  local label="$1"
  local url="$2"
  local expected_namespace="$3"
  local expected_path="$4"
  local body
  request "$label" "$url" "application/json" || return 0
  body="$REQUEST_BODY"
  assert_nrp_api_status "$label" "$body" || return 0
  assert_json "$label" "$body" || return 0
  assert_nrp_cache_contract "$label" "$body" || return 0
  assert_nrp_target "$label target" "$body" "$expected_namespace" "$expected_path" || return 0
}

run_json_shape_test() {
  local label="$1"
  local url="$2"
  local body
  request "$label" "$url" "application/json" || return 0
  body="$REQUEST_BODY"
  assert_2xx "$label" "$body" || return 0
  assert_json "$label" "$body" || return 0
  assert_nrp_cache_contract "$label" "$body" || return 0
}

print_header

# Browser navigation must return the namespace SPA HTML.
run_html_test "browser root receives SPA" "${BASE_URL}/"
run_html_test "browser path receives SPA" "${BASE_URL}/name"
run_html_test "browser handle root receives SPA" "${BASE_URL}/@${HANDLE}"
run_html_test "browser handle path receives SPA" "${BASE_URL}/@${HANDLE}/name"

# API/fetch calls must resolve through the NRP and return JSON for the same paths.
run_json_test "api root path /name" "${BASE_URL}/name" "$ROOT_HOST" "name"
run_json_test "api handle root /@${HANDLE}" "${BASE_URL}/@${HANDLE}" "${HANDLE}.${ROOT_HOST}" "/"
run_json_test "api handle path /@${HANDLE}/name" "${BASE_URL}/@${HANDLE}/name" "${HANDLE}.${ROOT_HOST}" "name"

# Blockchain feed endpoint should remain available for the unfiltered root feed.
run_json_shape_test "api root blockchain feed" "${BASE_URL}/blockchain?limit=3"
run_json_test "api handle blockchain feed /@${HANDLE}/blockchain" "${BASE_URL}/@${HANDLE}/blockchain?limit=3" "${HANDLE}.${ROOT_HOST}" "blockchain"

# Optional host-style handle surface. Enable once wildcard DNS/cert routing is active.
if [[ "${NRP_TEST_HANDLE_HOST:-0}" == "1" ]]; then
  run_json_test "api handle host /name" "${HANDLE_BASE_URL}/name" "${HANDLE}.${ROOT_HOST}" "name"
fi

printf '\nResult: %s passed, %s failed\n' "$pass_count" "$fail_count"
if [[ "$fail_count" -ne 0 ]]; then
  exit 1
fi
