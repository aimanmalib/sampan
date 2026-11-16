import { describe, expect, it } from 'vitest';
import config from '../config/sampan.json' with { type: 'json' };
import { ClientIp, inCidr } from './client-ip.js';

const cidrs = config.rate.cloudflareCidrs;
const CF = '104.16.1.2';

describe('inCidr', () => {
  it('matches IPv4 and IPv6 ranges, including mapped IPv4', () => {
    expect(inCidr('104.16.1.2', '104.16.0.0/13')).toBe(true);
    expect(inCidr('::ffff:104.16.1.2', '104.16.0.0/13')).toBe(true);
    expect(inCidr('104.24.0.1', '104.16.0.0/13')).toBe(false);
    expect(inCidr('2606:4700::1', '2606:4700::/32')).toBe(true);
    expect(inCidr('2607:4700::1', '2606:4700::/32')).toBe(false);
    expect(inCidr('2606:4700::1', '104.16.0.0/13')).toBe(false);
  });
});

describe('ClientIp', () => {
  const ip = async () => {
    const c = new ClientIp({ trustedProxies: ['proxy'], cloudflareCidrs: cidrs, resolve: async () => ['10.0.0.2'] });
    await c.refresh();
    return c;
  };

  it('ignores forwarded headers from anything but the proxy', async () => {
    const c = await ip();
    expect(c.of('10.0.0.9', { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' })).toBe('10.0.0.9');
  });

  it('uses the last X-Forwarded-For entry from the proxy, not earlier spoofable ones', async () => {
    const c = await ip();
    expect(c.of('10.0.0.2', { 'x-forwarded-for': '9.9.9.9, 1.2.3.4' })).toBe('1.2.3.4');
  });

  it('reads cf-ipcountry only through Cloudflare via the proxy', async () => {
    const c = await ip();
    expect(c.country('10.0.0.2', { 'x-forwarded-for': CF, 'cf-ipcountry': 'kp' })).toBe('KP');
    expect(c.country('10.0.0.2', { 'x-forwarded-for': '1.2.3.4', 'cf-ipcountry': 'KP' })).toBeNull();
    expect(c.country('10.0.0.9', { 'x-forwarded-for': CF, 'cf-ipcountry': 'KP' })).toBeNull();
    expect(c.country('10.0.0.2', { 'x-forwarded-for': CF, 'cf-ipcountry': 'XX1' })).toBeNull();
  });

  it('believes cf-connecting-ip only when the proxy saw a Cloudflare address', async () => {
    const c = await ip();
    expect(c.of('10.0.0.2', { 'x-forwarded-for': CF, 'cf-connecting-ip': '5.6.7.8' })).toBe('5.6.7.8');
    expect(c.of('10.0.0.2', { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' })).toBe('1.2.3.4');
  });

  it('with no proxy configured, the socket address is the caller', async () => {
    const c = new ClientIp({ trustedProxies: [], cloudflareCidrs: cidrs });
    await c.refresh();
    expect(c.of('::ffff:172.18.0.5', { 'x-forwarded-for': '1.2.3.4' })).toBe('172.18.0.5');
  });
});
