export function getPublicAppOrigin(): string {
  if (typeof window === 'undefined') return '';
  const { origin } = window.location;
  if (origin.includes('://ais-dev-')) {
    return origin.replace('://ais-dev-', '://ais-pre-');
  }
  return origin;
}

export function buildInviteShareUrl(inviteCode: string): string {
  const base = getPublicAppOrigin();
  return `${base}/?invite=${encodeURIComponent(inviteCode)}`;
}

export function buildNearbyShareUrl(roomCode: string): string {
  const base = getPublicAppOrigin();
  return `${base}/?nearby=${encodeURIComponent(roomCode)}`;
}
