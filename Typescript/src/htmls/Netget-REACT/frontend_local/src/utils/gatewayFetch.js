// gatewayFetch.js -- a request to the SELECTED gateway, carrying that gateway's credentials and only its.
//
//   this netget + an identity signed in through the selected link   the identity's signed proof (X-Me-Proof), per request: what
//                                                                   nginx's /logs and /check-auth ask for
//   this netget, no identity, a stored admin session                that session as a bearer token
//   a gateway that was added                                        ITS admin session as a bearer token, at ITS origin. The shell's
//                                                                   identity is never signed for another gateway (a proof is made for
//                                                                   one gateway's hostname), and one gateway's token never goes to another.
//   nothing                                                         the plain request (the gateway refuses it)
//
// The gateway still authorizes every request: this only decides what is attached.
import { gatewayRequest } from './gateways.js';

/**
 * @param {{ gateway: object, token: string|null, session: { node: unknown, hostname: string }|null,
 *           signedRequest: Function, fetchImpl?: Function }} credentials
 *   `token`: the admin session stored FOR THIS gateway (gateways.js sessionFor). `session`: the proof material of the identity
 *   signed in through the selected link, or null.
 */
export function gatewayFetch({ gateway, token, session, signedRequest, fetchImpl = fetch }, path, init = {}) {
  if (gateway.local && session) return signedRequest(session.node, session.hostname, path, init);
  const { url, init: withToken } = gatewayRequest(gateway, path, init, token);
  return fetchImpl(url, withToken);
}
