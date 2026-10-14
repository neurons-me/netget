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
