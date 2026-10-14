// authorizedRoots.ts -- which roots the router may hand names to, and to WHOM.
//
// A monad announces what it can resolve (its namespace, its aliases). That is capability. It does not make the monad the
// destination of a root: otherwise any process that registers on this machine (registration is loopback-only, not
// authenticated per monad) would capture every name under the root by announcing it. Authority comes from two places that
// the gateway already has:
//
//   * the OPERATOR, with the patch bay: a wildcard route `*.<root>` -> app:<name>, written through the same gate as any
//     route (gateway:write), is a declaration like any other and the router reads it as such;
//   * the INSTALLATION: the root this gateway is configured with (getGatewayRootNamespace()), bound to the identity of the
//     monad netget itself started. That is `roots` in domain-map.json, below.
//
// An alias of a root is not deduced: it is authorized the same way, by a declaration (`*.<alias>` -> app:<name>).
import { readMonadRecord } from 'monad.ai';
import { getGatewayRootNamespace, getMonadName } from '../kernel/netgetMonadProcess.js';
import { readReportedApps } from './appRegistry.js';

export interface AuthorizedRoot {
    /** The app (registry name / monad name) that attends names under the root. */
    app: string;
    /** The identity (identity_hash) the registration must carry: another monad announcing the same root is not it. */
    identity: string;
    source: 'installation';
}

/**
 * The roots this installation authorizes by itself: its configured root, bound to its own monad's identity. Nothing when
 * the monad has no record yet (then nothing is authorized, and an address gets the neutral shell).
 */
export async function installationRoots(): Promise<Record<string, AuthorizedRoot>> {
    try {
        const name = getMonadName();
        const root = String(getGatewayRootNamespace() || '').trim().toLowerCase();
        if (!root || root.includes('*')) return {};
        const record: any = await readMonadRecord(name);
        const identity = String(record?.identity_hash || record?.identityHash || '').trim();
        if (!identity) return {};
        return { [root]: { app: name, identity, source: 'installation' } };
    } catch {
        return {};
    }
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const WILDCARD = new RegExp(`^\\*\\.${LABEL}(?:\\.${LABEL})*$`);

/** A name that contains `*` is valid only as `*.<name>`: one leading wildcard label, then plain labels. */
export function isValidDomainPattern(domain: string): boolean {
    const d = String(domain || '').trim().toLowerCase();
    if (!d.includes('*')) return true;
    return WILDCARD.test(d);
}

/** `app:<name>` -> `<name>` (lowercase), or null for any other kind of destination. */
export function appNameOfTarget(target: string | null | undefined): string | null {
    const m = /^app:(.+)$/i.exec(String(target ?? '').trim());
    return m ? m[1].trim().toLowerCase() : null;
}

export class WildcardBindingError extends Error {
    readonly code: 'WILDCARD_APP_NOT_LIVE' | 'WILDCARD_APP_IDENTITY';
    constructor(code: WildcardBindingError['code'], reason: string) {
        super(reason);
        this.name = 'WildcardBindingError';
        this.code = code;
    }
}

/**
 * The identity a wildcard route `*.<name>` -> app:<app> is bound to, decided when the OPERATOR declares it (through the
 * gate): the single identity the app is registered under right now. Naming the app is not enough, or a declaration
 * `*.localhost -> app:netget` would be served by whichever process registers as `netget`. Refused, writing nothing, when
 * the app is not live (nothing to bind to) or live under several identities or none (not something recency may settle).
 * Matching the app mirrors the router (registry name, name without `monad:`, or metadata.monadName).
 */
export function identityBoundTo(app: string): string {
    const want = app.trim().toLowerCase();
    const identities = new Set<string>();
    let live = 0;
    for (const reg of readReportedApps() as any[]) {
        if (!reg.alive) continue;
        const name = String(reg.name || '').toLowerCase();
        const short = name.replace(/^monad:/, '');
        const meta = (reg.metadata && typeof reg.metadata === 'object') ? reg.metadata : {};
        if (!(name === want || short === want || String(meta.monadName || '').toLowerCase() === want)) continue;
        live += 1;
        identities.add(String(meta.identity_hash || meta.identityHash || '').trim());
    }
    if (live === 0) throw new WildcardBindingError('WILDCARD_APP_NOT_LIVE', `la app "${app}" no está viva: un comodín se liga a la identidad de su destino al declararlo`);
    if (identities.size !== 1 || identities.has('')) {
        throw new WildcardBindingError('WILDCARD_APP_IDENTITY', `la app "${app}" no tiene una única identidad registrada: no hay a qué ligar el comodín`);
    }
    return [...identities][0];
}
