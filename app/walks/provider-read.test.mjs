import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRequest } from './browser.mjs';

const target = 'https://godiesel.pages.dev';
const rpc = 'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMap3DConfig';

test('the actual Google SDK 3D-configuration read may use POST', () => {
  assert.equal(allowedRequest(rpc, 'POST', target), true);
  assert.equal(allowedRequest(rpc, 'POST', 'http://127.0.0.1:8792'), true);
});
test('the provider-read exception does not authorize writes or other methods', () => {
  for (const url of [target + '/api/curation/save', 'http://127.0.0.1:8766/api/curation/save',
    'https://maps.googleapis.com/anything', rpc.replace('GetMap3DConfig', 'PublishMap'),
    rpc.replace('https:', 'http:'), rpc.replace('maps.googleapis.com', 'maps.googleapis.com.attacker.invalid'),
    rpc.replace('maps.googleapis.com', 'maps.googleapis.com:444'), rpc.replace('https://', 'https://user:pass@'),
    rpc + '?next=/api/curation/save', rpc + '/extra']) {
    assert.equal(allowedRequest(url, 'POST', target), false, url);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal(allowedRequest(rpc, method, target), false);
});
