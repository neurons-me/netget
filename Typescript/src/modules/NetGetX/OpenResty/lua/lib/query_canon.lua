-- query_canon.lua — canonical form of a request's query string, shared by
-- middleware/me_sig.lua (signature verification) and
-- tests/gateway-query-canonicalization.test.ts (direct, shared-vector
-- comparison against the real client-side implementation). A plain,
-- requirable library (not loadfile()'d) — unlike me_sig.lua, it holds no
-- per-request state, so normal require() caching is fine.
--
-- Must mirror signedRequest.ts's canonicalizeQuery() byte-for-byte, since
-- both sides are compared with plain string equality (same as the
-- existing path/bodyHash checks) — never with set/semantic equality:
--
--   1. Decoding: application/x-www-form-urlencoded, the same convention
--      URLSearchParams uses — "+" decodes to a literal space, then
--      standard percent-decoding. A malformed escape (not "%" followed by
--      exactly two hex digits, e.g. "%zz" or a trailing bare "%") is left
--      as the literal bytes it was, not an error and not substituted —
--      confirmed empirically to be exactly what URLSearchParams itself
--      does (node -e 'new URLSearchParams("bad=%zz")' → {bad: "%zz"}),
--      so no divergent "invalid escape" policy had to be invented here.
--      Deliberately NOT ngx.req.get_uri_args(): that returns a Lua table,
--      whose iteration across distinct key names has no defined order at
--      all (Lua tables are not ordered), and would silently discard the
--      ordering point 2 depends on.
--   2. Order: pairs are kept in EXACT appearance order, left to right,
--      across distinct keys and repeated ones alike — never sorted. A
--      handler reading a repeated query key may take the first or last
--      value (logs.lua's own parse_qs() takes get_uri_args()'s v[1], i.e.
--      first-appended) — two different ORDERINGS of the same key=value
--      pairs are therefore operationally DIFFERENT requests
--      ("?type=access&type=error" vs "?type=error&type=access" select
--      opposite values under first-wins semantics), and sorting them into
--      one canonical order would let a single proof cover both. Since
--      there is exactly one real input string being parsed identically on
--      both sides, appearance order is already deterministic and
--      canonical on its own — no sorting step was ever needed for that
--      part, only for avoiding it.
--   3. Encoding: a JSON array of [key, value] string pairs — reusing JSON
--      encoding (already how the top-level challenge is canonicalized)
--      instead of a hand-rolled delimiter-joined string, which would be
--      ambiguous the moment a key or value itself contains "=" or "&".
--
-- See gateway-query-canonicalization.test.ts for the shared vectors this
-- is checked against directly (repeated-key order, Unicode, "+", "%20",
-- empty values, malformed escapes) — run against the REAL compiled
-- signedRequest.ts canonicalizeQuery() on one side and this exact file,
-- loaded by a disposable OpenResty, on the other.

local cjson = require "cjson.safe"

local M = {}

local function decode_form_component(s)
  s = s:gsub("+", " ")
  return (s:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end

-- qs: the raw query string, with NO leading "?" (ngx.var.args's own
-- convention — pass that directly).
function M.canonicalize(qs)
  qs = qs or ""
  local pairs_list = {}
  if qs ~= "" then
    for piece in (qs .. "&"):gmatch("([^&]*)&") do
      if piece ~= "" then
        local eq = piece:find("=", 1, true)
        local k, v
        if eq then
          k = decode_form_component(piece:sub(1, eq - 1))
          v = decode_form_component(piece:sub(eq + 1))
        else
          k = decode_form_component(piece)
          v = ""
        end
        pairs_list[#pairs_list + 1] = { k, v }
      end
    end
  end
  local parts = {}
  for i, pair in ipairs(pairs_list) do
    parts[i] = cjson.encode(pair)
  end
  return "[" .. table.concat(parts, ",") .. "]"
end

return M
