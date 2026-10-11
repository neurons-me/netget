// domainsProjection.mjs -- what an anonymous visitor may read about a domain.
//
// GET /domains is a public route (adminGate.mjs PUBLIC_ROUTES): "this server serves these names" is meant to be
// readable. A domain record, though, carries the machine's own wiring: where the files are, which certificate and
// key files the TLS uses, who the contact is, the graph path it is stored at. Being public as a name does not make
// its configuration public, and the certificate/key PATHS are not secrets but nobody needs them from outside.
//
// So the public answer is built from an explicit allow-list, field by field. A field that is added to the record
// later is not public until someone adds it here: the default is out, not in. The full record is what the router
// (domain-map.json, generated from the store, untouched by this) and an authorized admin session get.
//
// `tlsConfigured` is configuration, not a verified certificate or a checked HTTPS connection.
//
// What is NOT decided here: which domains an owner wants to announce at all (per-record visibility). That is a
// separate design; this only stops the unnecessary exposure of the fields of the domains that are listed.

/** The only fields of a domain record that leave on an anonymous answer. */
export const PUBLIC_DOMAIN_FIELDS = Object.freeze(['domain', 'type', 'subdomain']);

/**
 * One row, as an anonymous visitor sees it: the allow-listed fields, plus `tlsConfigured`.
 *
 * `tlsConfigured` says the record is set up to terminate TLS (it has an ssl mode other than none/off). It does NOT say
 * that a certificate exists, is current, or that an HTTPS connection was ever checked: that would need an actual
 * check, which this projection does not make. Named for what it is, so no reader takes it for more.
 */
export function publicDomainView(row) {
  const src = row && typeof row === 'object' ? row : {};
  const out = {};
  for (const key of PUBLIC_DOMAIN_FIELDS) {
    const value = src[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  const sslMode = String(src.sslMode ?? '').trim().toLowerCase();
  out.tlsConfigured = Boolean(sslMode) && sslMode !== 'none' && sslMode !== 'off';
  return out;
}
