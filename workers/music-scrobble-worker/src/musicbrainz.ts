export interface MusicBrainzArtistCredit {
  artistMbid: string;
  name: string;
  joinPhrase: string;
}

export interface ResolvedMusicBrainzRecording {
  recordingMbid: string;
  title: string;
  durationMs?: number;
  artistCredit: MusicBrainzArtistCredit[];
  primaryArtistMbid: string;
  releaseMbid?: string;
  isrcs: string[];
}

export interface MusicBrainzClientOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  minimumIntervalMs?: number;
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertMbid(value: string, field = 'mbid'): string {
  if (!MBID.test(value)) throw new Error(`${field} must be a MusicBrainz UUID`);
  return value.toLowerCase();
}

export class MusicBrainzClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly minimumIntervalMs: number;
  private nextRequestAt = 0;

  constructor(options: MusicBrainzClientOptions) {
    if (!options.userAgent.trim() || !options.userAgent.includes('/')) {
      throw new Error('MusicBrainz userAgent must identify the application and version');
    }
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minimumIntervalMs = options.minimumIntervalMs ?? 1_000;
  }

  async resolveRecording(recordingMbid: string): Promise<ResolvedMusicBrainzRecording> {
    const id = assertMbid(recordingMbid, 'recordingMbid');
    await this.waitForSlot();

    const url = new URL(`https://musicbrainz.org/ws/2/recording/${id}`);
    url.searchParams.set('inc', 'artist-credits+releases+isrcs');
    url.searchParams.set('fmt', 'json');

    const response = await this.fetchImpl(url, {
      headers: {
        'user-agent': this.userAgent,
        accept: 'application/json',
      },
    });

    if (response.status === 404) throw new Error(`MusicBrainz recording '${id}' was not found`);
    if (response.status === 503) throw new Error('MusicBrainz is temporarily unavailable');
    if (!response.ok) throw new Error(`MusicBrainz lookup failed with HTTP ${response.status}`);

    const body = await response.json() as any;
    const credits = Array.isArray(body['artist-credit']) ? body['artist-credit'] : [];
    const artistCredit: MusicBrainzArtistCredit[] = credits
      .map((entry: any) => ({
        artistMbid: assertMbid(String(entry?.artist?.id ?? ''), 'artistMbid'),
        name: String(entry?.name ?? entry?.artist?.name ?? '').trim(),
        joinPhrase: String(entry?.joinphrase ?? ''),
      }))
      .filter((entry: MusicBrainzArtistCredit) => entry.name.length > 0);

    if (artistCredit.length === 0) throw new Error(`MusicBrainz recording '${id}' has no usable artist credit`);

    const releases = Array.isArray(body.releases) ? body.releases : [];
    const releaseMbid = releases[0]?.id ? assertMbid(String(releases[0].id), 'releaseMbid') : undefined;

    return {
      recordingMbid: id,
      title: String(body.title ?? '').trim(),
      durationMs: Number.isInteger(body.length) && body.length > 0 ? Number(body.length) : undefined,
      artistCredit,
      primaryArtistMbid: artistCredit[0].artistMbid,
      releaseMbid,
      isrcs: Array.isArray(body.isrcs) ? body.isrcs.map(String) : [],
    };
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const delay = Math.max(0, this.nextRequestAt - now);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.nextRequestAt = Date.now() + this.minimumIntervalMs;
  }
}
