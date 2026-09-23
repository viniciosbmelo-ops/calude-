import * as http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { requireAuth } from '../server/auth';

const SUB = 'aaaaaaaa-0000-0000-0000-000000000001';
const SECRET = 'segredo-hs256-com-mais-de-32-caracteres!!';

describe('requireAuth — HS256 legado e JWKS assimétrico', () => {
  let server: http.Server;
  let jwksUrl: string;
  let priv: CryptoKey;
  let otherPriv: CryptoKey;

  beforeAll(async () => {
    const kp = await generateKeyPair('ES256');
    priv = kp.privateKey as CryptoKey;
    otherPriv = (await generateKeyPair('ES256')).privateKey as CryptoKey;
    const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/v1/.well-known/jwks.json`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const app = (cfg: Parameters<typeof requireAuth>[0]) => {
    const a = express();
    a.get('/x', requireAuth(cfg), (req, res) => res.json({ id: req.user!.id }));
    return a;
  };
  const es = (key: CryptoKey, claims: Record<string, unknown> = {}, kid = 'k1') =>
    new SignJWT({ role: 'authenticated', ...claims }).setProtectedHeader({ alg: 'ES256', kid }).setSubject(SUB).setAudience('authenticated').setExpirationTime('5m').sign(key);
  const hs = (claims: Record<string, unknown> = {}) =>
    new SignJWT({ role: 'authenticated', ...claims }).setProtectedHeader({ alg: 'HS256' }).setSubject(SUB).setAudience('authenticated').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  const call = (a: express.Express, t: string) => request(a).get('/x').set('Authorization', `Bearer ${t}`);

  test('ES256 válido pelo JWKS', async () => {
    const r = await call(app({ jwksUrl }), await es(priv));
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(SUB);
  });
  test('ES256 assinado por outra chave → 401', async () => {
    expect((await call(app({ jwksUrl }), await es(otherPriv))).status).toBe(401);
  });
  test('HS256 recusado quando só há JWKS; aceito com segredo', async () => {
    expect((await call(app({ jwksUrl }), await hs())).status).toBe(401);
    expect((await call(app({ secret: SECRET, jwksUrl }), await hs())).status).toBe(200);
  });
  test('alg none, audiência errada, role anon, expirado → 401', async () => {
    const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: SUB, role: 'authenticated', aud: 'authenticated' })).toString('base64url') + '.';
    const a = app({ secret: SECRET, jwksUrl });
    expect((await call(a, none)).status).toBe(401);
    expect((await call(a, await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(SUB).setAudience('outro').setExpirationTime('5m').sign(priv))).status).toBe(401);
    expect((await call(a, await es(priv, { role: 'anon' }))).status).toBe(401);
    expect((await call(a, await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(SUB).setAudience('authenticated').setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new TextEncoder().encode(SECRET)))).status).toBe(401);
    expect((await request(a).get('/x')).status).toBe(401);
  });
  test('configuração inválida falha na inicialização', () => {
    expect(() => requireAuth({})).toThrow();
    expect(() => requireAuth({ secret: 'curto' })).toThrow();
  });
});
