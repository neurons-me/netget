import assert from 'node:assert/strict';
import { CURTAIN_CODE, acceptsCode, curtainClosed, curtainOverride, isCurtainHost } from '../src/htmls/Netget-REACT/frontend_local/src/session/comingSoon.js';

// which hosts get the curtain: the public sites and their subdomains; never this machine or an address
for (const h of ['cleaker.me', 'CLEAKER.ME', 'alice.cleaker.me', 'a.b.cleaker.me', 'netget.site', 'www.netget.site', 'cleaker.me.']) assert.equal(isCurtainHost(h), true, h);
for (const h of ['localhost', '127.0.0.1', '192.168.0.226', 'suis-macbook-air.local', 'alice.localhost', 'neurons.me', 'notcleaker.me', 'cleaker.me.evil.com', 'xnetget.site', '', undefined]) assert.equal(isCurtainHost(h), false, String(h));

// the code: exactly it, whitespace around it tolerated, nothing else
assert.equal(CURTAIN_CODE, '160490');
assert.equal(acceptsCode('160490'), true);
assert.equal(acceptsCode(' 160490 '), true);
for (const c of ['', '160491', '16049', '1604900', 'abcdef', undefined, null, 160491]) assert.equal(acceptsCode(c), false, String(c));
assert.equal(acceptsCode(160490), true); // a number is its own string

// override
assert.equal(curtainOverride('?curtain=on'), 'on');
assert.equal(curtainOverride('?x=1&curtain=reset'), 'reset');
assert.equal(curtainOverride('?curtain=off'), null);
assert.equal(curtainOverride(''), null);

// closed or open
const c = (o: object) => curtainClosed({ hostname: 'localhost', search: '', unlocked: false, ...o });
assert.equal(c({}), false, 'localhost: open');
assert.equal(c({ hostname: 'cleaker.me' }), true, 'public host: closed');
assert.equal(c({ hostname: 'cleaker.me', unlocked: true }), false, 'public host, this browser was let in: open');
assert.equal(c({ search: '?curtain=on' }), true, 'forced on a local host');
assert.equal(c({ search: '?curtain=on', unlocked: true }), false, 'forced, but already let in');
assert.equal(c({ hostname: 'cleaker.me', search: '?curtain=reset', unlocked: false }), true, 'reset: closed until the code is entered');
assert.equal(c({ hostname: 'cleaker.me', search: '?curtain=reset', unlocked: true }), false, 'once the code was accepted it wins, also with reset in the URL');
console.log('coming-soon: ok');
