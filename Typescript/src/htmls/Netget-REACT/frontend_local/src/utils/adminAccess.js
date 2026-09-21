// adminAccess.js -- what these screens say when the gateway refuses one of their admin actions.
//
// The gateway's routes that change what it is (add or remove a domain, provision a certificate, restart
// or stop OpenResty, switch the frontend mode) now need an admin session, or a process on the server itself.
// These older screens send neither, so the server answers 401/403. They must say why and what to do
// instead -- not fail with a bare status or an "expected JSON" error.

const CLI = {
  'add-domain': 'run `netget`, open Domains and add it there',
  'delete-domain': 'run `netget`, open Domains and remove it there',
  'provision-cert': (ctx) => `run \`netget provision-cert ${ctx?.domain || '<domain>'}\``,
  'domain-metadata': () => 'there is no CLI command for this yet; it comes back with the Cleaker admin screens',
  'openresty-restart': 'run `netget reload`',
  'openresty-stop': 'run `netget stop`',
  'frontend-mode': 'run `netget frontend-mode <mode>`',
};

/** True when the gateway refused the request for lack of an admin session (or nginx refused a non-local caller). */
export function isRefusal(response) {
  return response?.status === 401 || response?.status === 403;
}

/** The sentence to show for a refused admin action. */
export function refusalMessage(action, ctx) {
  const how = typeof CLI[action] === 'function' ? CLI[action](ctx) : CLI[action] || 'use the `netget` CLI on the server';
  return `Not available here: this action needs an admin session, and this screen does not have one yet `
    + `(the admin screens are moving to the Cleaker shell). Meanwhile, on the server, ${how}.`;
}
