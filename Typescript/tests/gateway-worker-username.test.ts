import assert from 'node:assert/strict';

const { getWorkerUsername } = await import('../src/modules/NetGetX/OpenResty/platformDetect.ts');

// Linux apt/source layouts.
assert.equal(getWorkerUsername({ userDirective: 'user www-data;' } as any), 'www-data');
assert.equal(getWorkerUsername({ userDirective: 'user nginx;' } as any), 'nginx');
assert.equal(getWorkerUsername({ userDirective: 'user nobody;' } as any), 'nobody');

// macOS launchd form: "user <name> staff;" — first token after "user" is the username.
assert.equal(getWorkerUsername({ userDirective: 'user suign staff;' } as any), 'suign');

// No directive detected (e.g. /etc/passwd had none of the known users) -> null, not a crash.
assert.equal(getWorkerUsername({ userDirective: '' } as any), null);

console.log('gateway-worker-username ok');
