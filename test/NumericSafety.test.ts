import { expect } from 'chai';
import { createRandomNonceChannel, toUintString } from '../sdk/src/numeric';

describe('OpenRails bigint-safe numeric helpers', () => {
  it('preserves uint values above Number.MAX_SAFE_INTEGER', () => {
    const value = (1n << 127n) + 123n;
    expect(toUintString(value, 'nonceChannel')).to.equal(value.toString());
    expect(toUintString(value.toString(), 'nonceChannel')).to.equal(value.toString());
  });

  it('rejects unsafe JavaScript numbers', () => {
    expect(() => toUintString(Number.MAX_SAFE_INTEGER + 1, 'nonceChannel')).to.throw('safe integer');
  });

  it('generates independent non-zero 128-bit nonce lanes', () => {
    const lanes = new Set(Array.from({ length: 32 }, () => createRandomNonceChannel()));
    expect(lanes.size).to.equal(32);
    for (const lane of lanes) {
      const value = BigInt(lane);
      expect(value).to.be.greaterThan(0n);
      expect(value).to.be.lessThan(1n << 128n);
    }
  });
});
