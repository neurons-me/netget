import assert from 'node:assert/strict';

// Regression test for the bug that broke https://netget.site in production:
// the main-server domain record was registered with a bare port ("3432") as
// its route target. The gateway's Lua proxy only expands "app:"-prefixed
// targets to host:port; any other target is used as-is in
// `proxy_pass http://<target>`, so a bare port resolves as an invalid
// hostname and the proxy always fails (502 -> gateway status fallback page).
const { formatMainServerTarget } = await import('../src/modules/NetGetX/mainServer/mainServer.cli.ts');

assert.equal(formatMainServerTarget(8161), '127.0.0.1:8161');
assert.equal(formatMainServerTarget('8161'), '127.0.0.1:8161');

// Falls back to the documented default port when unset, but must still be
// host:port, never a bare number.
assert.equal(formatMainServerTarget(undefined), '127.0.0.1:3432');

// Every output must match host:port shape — this is the actual proxy_pass
// target contract enforced by setNginxConfigFile.ts's Lua location handler.
for (const port of [8161, '8161', undefined, 0]) {
    const target = formatMainServerTarget(port as any);
    assert.match(target, /^127\.0\.0\.1:\d+$/, `formatMainServerTarget(${JSON.stringify(port)}) -> "${target}" is not host:port`);
}

console.log('main-server-target-format ok');
