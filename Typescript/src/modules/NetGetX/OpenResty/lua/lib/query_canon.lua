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
--   4. Invalid UTF-8: a percent-escape can be individually well-formed
--      ("%FF", "%C3%28") while the BYTES it decodes to do not form valid
--      UTF-8 -- a different failure mode than point 1's malformed escapes.
--      URLSearchParams does NOT pass these bytes through: per the WHATWG
--      URL spec it runs a stateful UTF-8 decode and substitutes each
--      invalid sequence with U+FFFD (confirmed empirically: "%FF" and
--      "%C3%28" both decode to U+FFFD-containing strings, not the raw
--      bytes). cjson.encode does NOT replicate that -- it treats Lua
--      strings as opaque bytes and passes them straight through, so
--      without this check "%FF" would canonicalize to a raw 0xFF byte
--      here but to "\xEF\xBF\xBD" (U+FFFD) on the real client, and the
--      two could never match for ANY request whose query happens to
--      contain invalid UTF-8 -- confirmed by direct byte comparison, not
--      assumed. Replicating WHATWG's exact replacement algorithm in Lua
--      was considered and rejected as out of scope for this pass (bigger
--      surface, more ways to get subtly wrong); instead, canonicalize()
--      detects invalid UTF-8 in any decoded key or value and returns
--      (nil, "ME_PROOF_QUERY_INVALID_ENCODING") -- a request whose query
--      doesn't decode to valid UTF-8 is rejected outright, consistently,
--      by me_sig.lua, rather than risking an unreliable byte-level
--      comparison for a case that cannot be proven to agree with the
--      client. This never throws (no internal error) -- callers get a
--      normal (nil, err) pair, same shape as cjson.safe's own functions.
--
-- See gateway-query-canonicalization.test.ts for the shared vectors this
-- is checked against directly (repeated-key order, Unicode, "+", "%20",
-- empty values, malformed escapes, invalid UTF-8) — run against the REAL
-- compiled signedRequest.ts canonicalizeQuery() on one side and this
-- exact file, loaded by a disposable OpenResty, on the other.

local cjson = require "cjson.safe"

local M = {}

local function decode_form_component(s)
  s = s:gsub("+", " ")
  return (s:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end

-- Strict UTF-8 validation (rejects overlong encodings, UTF-16 surrogate
-- halves, and anything beyond U+10FFFF) — no bundled OpenResty/LuaJIT
-- library does this (confirmed: neither a global `utf8` nor `require
-- "utf8"`/"lua-utf8" is available in this runtime), so it is hand-rolled
-- here, scoped to exactly what point 4 above needs: a yes/no validity
-- check, not a decoder.
local function is_valid_utf8(s)
  local i, n = 1, #s
  while i <= n do
    local b1 = s:byte(i)
    if b1 < 0x80 then
      i = i + 1
    elseif b1 >= 0xC2 and b1 <= 0xDF then
      local b2 = s:byte(i + 1)
      if not b2 or b2 < 0x80 or b2 > 0xBF then return false end
      i = i + 2
    elseif b1 == 0xE0 then
      local b2, b3 = s:byte(i + 1), s:byte(i + 2)
      if not b2 or b2 < 0xA0 or b2 > 0xBF then return false end
      if not b3 or b3 < 0x80 or b3 > 0xBF then return false end
      i = i + 3
    elseif (b1 >= 0xE1 and b1 <= 0xEC) or b1 == 0xEE or b1 == 0xEF then
      local b2, b3 = s:byte(i + 1), s:byte(i + 2)
      if not b2 or b2 < 0x80 or b2 > 0xBF then return false end
      if not b3 or b3 < 0x80 or b3 > 0xBF then return false end
      i = i + 3
    elseif b1 == 0xED then
      -- excludes the UTF-16 surrogate range D800-DFFF
      local b2, b3 = s:byte(i + 1), s:byte(i + 2)
      if not b2 or b2 < 0x80 or b2 > 0x9F then return false end
      if not b3 or b3 < 0x80 or b3 > 0xBF then return false end
      i = i + 3
    elseif b1 == 0xF0 then
      local b2, b3, b4 = s:byte(i + 1), s:byte(i + 2), s:byte(i + 3)
      if not b2 or b2 < 0x90 or b2 > 0xBF then return false end
      if not b3 or b3 < 0x80 or b3 > 0xBF then return false end
      if not b4 or b4 < 0x80 or b4 > 0xBF then return false end
      i = i + 4
    elseif b1 >= 0xF1 and b1 <= 0xF3 then
      local b2, b3, b4 = s:byte(i + 1), s:byte(i + 2), s:byte(i + 3)
      if not b2 or b2 < 0x80 or b2 > 0xBF then return false end
      if not b3 or b3 < 0x80 or b3 > 0xBF then return false end
      if not b4 or b4 < 0x80 or b4 > 0xBF then return false end
      i = i + 4
    elseif b1 == 0xF4 then
      -- caps at U+10FFFF
      local b2, b3, b4 = s:byte(i + 1), s:byte(i + 2), s:byte(i + 3)
      if not b2 or b2 < 0x80 or b2 > 0x8F then return false end
      if not b3 or b3 < 0x80 or b3 > 0xBF then return false end
      if not b4 or b4 < 0x80 or b4 > 0xBF then return false end
      i = i + 4
    else
      -- 0x80-0xC1: a bare continuation byte, or the overlong C0/C1 lead
      -- bytes (always invalid). 0xF5-0xFF: beyond U+10FFFF or reserved.
      return false
    end
  end
  return true
end

-- qs: the raw query string, with NO leading "?" (ngx.var.args's own
-- convention — pass that directly).
-- Returns (canonical_string, nil) on success, or (nil, error_code) when
-- the query decodes to invalid UTF-8 — see point 4 above. Never throws.
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
        if not is_valid_utf8(k) or not is_valid_utf8(v) then
          return nil, "ME_PROOF_QUERY_INVALID_ENCODING"
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
