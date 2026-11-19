import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/auth', () => ({ authHeader: async () => ({}) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const membersPath = '/api/houses/DEMOHOME/members';

test.each([
  { platform: 'android', override: undefined, origin: 'https://bx.aranlucas.workers.dev' },
  { platform: 'android', override: '', origin: 'https://bx.aranlucas.workers.dev' },
  { platform: 'ios', override: undefined, origin: 'https://bx.aranlucas.workers.dev' },
  { platform: 'android', override: 'https://preview.example.com/', origin: 'https://preview.example.com' },
  { platform: 'web', override: undefined, origin: '' },
  { platform: 'web', override: 'http://localhost:8788', origin: 'http://localhost:8788' },
])('loads members on $platform with API URL $override', async ({ platform, override, origin }) => {
  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: platform } }));
  vi.stubEnv('EXPO_PUBLIC_API_URL', override);

  const people = { members: [], invites: [] };
  const fetchMembers = vi.fn(async () => Response.json(people));
  vi.stubGlobal('fetch', fetchMembers);
  const { api } = await import('../src/lib/api');

  await expect(api.members('DEMOHOME')).resolves.toEqual(people);
  expect(fetchMembers).toHaveBeenCalledWith(`${origin}${membersPath}`, expect.any(Object));
});
