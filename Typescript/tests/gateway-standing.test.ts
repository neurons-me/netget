import assert from 'node:assert/strict';

// The permission block of the Domains screen must not contradict what the shell knows. Two different things were being said with one
// voice: "who does this gateway think I am" (the identity signed in through the selected link: the "Unlocked" chip, the sidebar) and
// "what may I WRITE here" (the write gate of /add-domain & co. accepts an admin SESSION with gateway:write, not a signed proof). Both are
// true at once, so the screen says both, and says what is missing, instead of "no session" next to "Unlocked".
const FE = '../src/htmls/Netget-REACT/frontend_local/src';
const { identityStanding } = await import(`${FE}/utils/identityStanding.js`);

const local = { id: 'local', local: true };
const added = { id: 'gw-other', local: false };
const owner = { authenticated: true, isOwner: true, isAdmin: false, scopes: [] };
const admin = { authenticated: true, isOwner: false, isAdmin: true, scopes: ['gateway:read'] };
const plain = { authenticated: true, isOwner: false, isAdmin: false, scopes: ['gateway:read'] };
const modifyNo = { state: 'no', basis: 'Sin sesión para este gateway: solo lo que divulga.' };
const modifyYes = { state: 'yes', basis: 'El gateway autorizó la sesión y rechazó una petición vacía: no se escribió nada.' };

// ── this netget ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const s = identityStanding({ gateway: local, signedIn: true, checking: false, recognition: owner, hasToken: false, modify: modifyNo });
  assert.equal(s.state, 'admin');
  assert.match(s.text, /dueña/, 'the owner');
  assert.match(s.modifyBasis, /sesión de administración/, 'it says what is missing for writing');
  assert.doesNotMatch(s.modifyBasis, /Sin sesión para este gateway/, 'and no longer says "no session" next to an identity this gateway recognizes');
  {
    const s = identityStanding({ gateway: local, signedIn: true, checking: false, recognition: admin, hasToken: false, modify: modifyNo });
    assert.equal(s.state, 'admin', 'an administrator too');
    assert.match(s.text, /administradora/);
  }
}
{
  const s = identityStanding({ gateway: local, signedIn: true, checking: false, recognition: owner, hasToken: true, modify: modifyYes });
  assert.equal(s.state, 'admin');
  assert.equal(s.modifyBasis, modifyYes.basis, 'with an accepted session the gateway\'s own answer is what is shown');
}
{
  const s = identityStanding({ gateway: local, signedIn: true, checking: false, recognition: owner, hasToken: true, modify: { state: 'no', basis: 'El gateway no acepta esta sesión (401).' } });
  assert.equal(s.modifyBasis, 'El gateway no acepta esta sesión (401).', 'a stored session the gateway refuses is reported as the gateway said it');
}
{
  const s = identityStanding({ gateway: local, signedIn: true, checking: false, recognition: plain, hasToken: false, modify: modifyNo });
  assert.equal(s.state, 'recognized');
  assert.match(s.text, /sin rol de administración/);
  assert.equal(s.modifyBasis, modifyNo.basis, 'recognized but not administrator: nothing more to say about writing');
}
assert.equal(identityStanding({ gateway: local, signedIn: true, checking: false, recognition: null, hasToken: false, modify: modifyNo }).state, 'unrecognized');
assert.match(identityStanding({ gateway: local, signedIn: true, checking: false, recognition: null, hasToken: false, modify: modifyNo }).text, /no reconoce/);
assert.equal(identityStanding({ gateway: local, signedIn: true, checking: true, recognition: null, hasToken: false, modify: modifyNo }).state, 'checking');
assert.equal(identityStanding({ gateway: local, signedIn: false, checking: false, recognition: null, hasToken: false, modify: modifyNo }).state, 'none');
assert.equal(identityStanding({ gateway: local, signedIn: false, checking: false, recognition: null, hasToken: false, modify: modifyNo }).modifyBasis, modifyNo.basis);

// ── a gateway that was added: the shell's identity is not used there, only its own session ─────────────────────────────────
{
  const s = identityStanding({ gateway: added, signedIn: true, checking: false, recognition: owner, hasToken: false, modify: modifyNo });
  assert.equal(s.state, 'not-applicable');
  assert.match(s.text, /sesión de administración/);
  assert.equal(s.modifyBasis, modifyNo.basis, 'what the local gateway thinks of her says nothing about this one');
}

// ── the whole standing is data: the screen only shows it ─────────────────────────────────────────────────────────────────
for (const s of [
  identityStanding({ gateway: local, signedIn: true, checking: false, recognition: owner, hasToken: false, modify: modifyNo }),
  identityStanding({ gateway: added, signedIn: false, checking: false, recognition: null, hasToken: true, modify: modifyYes }),
]) {
  assert.equal(typeof s.state, 'string');
  assert.equal(typeof s.text, 'string');
  assert.equal(typeof s.modifyBasis, 'string');
  assert.ok(['success', 'warning', 'default', 'error'].includes(s.color));
}

console.log('gateway-standing: ok');
