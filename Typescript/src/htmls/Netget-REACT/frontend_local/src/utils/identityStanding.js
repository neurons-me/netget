// identityStanding.js -- what the Domains screen says about WHO the selected gateway thinks you are, next to what you may WRITE.
//
// Two facts, true at once, that one line used to blur:
//   * the identity signed in through the selected link, and what this netget answers to its signed /check-auth (owner, administrator,
//     recognized, not recognized): the same answer the shell's sidebar and the "Unlocked" chip rest on;
//   * what the write gate accepts: an admin SESSION with gateway:write (a bearer token), asked of the gateway itself by an empty POST
//     (utils/gatewayProbe.js). A signed proof does not open it.
// So an administrator without a stored session is "recognized as administrator" AND "cannot write yet: this screen needs a session".
// Pure: it only turns what the screen already knows into the words it shows.

/**
 * @param {{ gateway: { local: boolean }, signedIn: boolean, checking: boolean, recognition: object|null,
 *           hasToken: boolean, modify: { state: string, basis: string } }} input
 *   `recognition`: the /check-auth answer when the gateway recognized the proof, else null.
 * @returns {{ state: string, text: string, color: string, modifyBasis: string }}
 */
export function identityStanding({ gateway, signedIn, checking, recognition, hasToken, modify }) {
  const same = { modifyBasis: modify.basis };
  if (!gateway.local) {
    return { ...same, state: 'not-applicable', color: 'default', text: 'En un gateway añadido no se usa la identidad del shell: solo su sesión de administración.' };
  }
  if (!signedIn) return { ...same, state: 'none', color: 'default', text: 'Sin identidad iniciada en el shell.' };
  if (checking) return { ...same, state: 'checking', color: 'default', text: 'Preguntándole a este gateway quién eres…' };
  if (!recognition) return { ...same, state: 'unrecognized', color: 'warning', text: 'Este gateway no reconoce a la identidad iniciada.' };
  if (recognition.isOwner === true || recognition.isAdmin === true) {
    const missing = modify.state !== 'yes' && !hasToken;
    return {
      state: 'admin',
      color: 'success',
      text: recognition.isOwner === true ? 'Reconocida como dueña de este gateway.' : 'Reconocida como administradora de este gateway.',
      modifyBasis: missing
        ? 'Tu identidad es administradora de este gateway, pero las escrituras de esta pantalla piden una sesión de administración (la que emite el gateway, abajo): todavía no hay una guardada.'
        : modify.basis,
    };
  }
  return { ...same, state: 'recognized', color: 'default', text: 'Reconocida por este gateway, sin rol de administración.' };
}
