import { expect } from 'chai';
import { ethers } from 'ethers';
import { MusicBrainzClient } from '../workers/music-scrobble-worker/src/musicbrainz';
import {
  buildCreatorRegistrationMessage,
  calculateTrackAllocation,
  verifyCreatorRegistration,
} from '../workers/music-scrobble-worker/src/creatorRegistry';

const RECORDING_MBID = '0f9e6c30-7e8d-4e5f-9cb3-12f832759a1f';
const ARTIST_MBID = '9fdaa16b-a6c4-4831-b87c-bc9ca8ce7eaa';
const RELEASE_MBID = '2a95e44f-7080-4b15-bfb1-8f38a53f58a4';

describe('MusicBrainz Creator Rail', () => {
  it('resolves a Recording MBID into canonical artist-credit data', async () => {
    const requests: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    const client = new MusicBrainzClient({
      userAgent: 'OpenRails/0.2.0 (dev@openrails.example)',
      minimumIntervalMs: 0,
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), headers: init?.headers });
        return new Response(JSON.stringify({
          id: RECORDING_MBID,
          title: 'Continuous Value',
          length: 240000,
          isrcs: ['US-OR1-26-00001'],
          'artist-credit': [{
            name: 'Open Creator',
            joinphrase: '',
            artist: { id: ARTIST_MBID, name: 'Open Creator' },
          }],
          releases: [{ id: RELEASE_MBID }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const recording = await client.resolveRecording(RECORDING_MBID);
    expect(recording.primaryArtistMbid).to.equal(ARTIST_MBID);
    expect(recording.durationMs).to.equal(240000);
    expect(recording.isrcs).to.deep.equal(['US-OR1-26-00001']);
    expect(requests[0].url).to.include('/ws/2/recording/');
    expect(requests[0].url).to.include('artist-credits');
  });

  it('verifies payout-wallet control with an expiring signed challenge', async () => {
    const wallet = ethers.Wallet.createRandom();
    const now = 1_800_000_000;
    const challenge = {
      artistMbid: ARTIST_MBID,
      wallet: wallet.address,
      registryOrigin: 'https://openrails.example',
      chainId: 5042002,
      issuedAt: now,
      expiresAt: now + 600,
      nonce: 'creator-reg-1',
    };
    const signature = await wallet.signMessage(buildCreatorRegistrationMessage(challenge));
    const registration = verifyCreatorRegistration(challenge, signature, now + 30);
    expect(registration.wallet).to.equal(wallet.address);
    expect(registration.verificationStatus).to.equal('wallet_verified');
  });

  it('caps a child music stream by remaining Session budget, track duration and per-track policy', () => {
    expect(calculateTrackAllocation({
      remainingSessionAllocation: 1_000_000n,
      velocityPerSecond: 1_000n,
      durationSeconds: 240,
      perTrackCap: 200_000n,
    })).to.equal(200_000n);

    expect(calculateTrackAllocation({
      remainingSessionAllocation: 100_000n,
      velocityPerSecond: 1_000n,
      durationSeconds: 240,
      perTrackCap: 200_000n,
    })).to.equal(100_000n);
  });
});
