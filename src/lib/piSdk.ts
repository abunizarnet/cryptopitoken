export interface PiUser {
  uid: string;
  username: string;
}

export interface PiAuthResult {
  accessToken: string;
  user: PiUser;
}

interface PiSdkGlobal {
  init: (config: { version: string; sandbox?: boolean }) => void;
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound?: (payment: unknown) => void
  ) => Promise<PiAuthResult>;
}

declare global {
  interface Window {
    Pi?: PiSdkGlobal;
  }
}

let piInitialized = false;

export function isPiSandboxEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const ref = document.referrer || '';
  return (
    ref.includes('sandbox.minepi.com') ||
    host.includes('localhost') ||
    host.includes('ais-dev-') ||
    host.includes('ais-pre-')
  );
}

export function isPiSdkAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.Pi !== 'undefined';
}

export function initPiSdk(): boolean {
  if (!isPiSdkAvailable() || !window.Pi) return false;
  if (!piInitialized) {
    window.Pi.init({
      version: '2.0',
      sandbox: isPiSandboxEnvironment(),
    });
    piInitialized = true;
  }
  return true;
}

export async function authenticateWithPiSandbox(): Promise<{
  uid: string;
  username: string;
  verified: boolean;
}> {
  if (!initPiSdk() || !window.Pi) {
    throw new Error(
      'Pi SDK is only active inside Pi Browser or sandbox.minepi.com.'
    );
  }

  const authResult = await window.Pi.authenticate(['username'], () => {
    // No pending payments expected in tap-to-mine flow
  });

  const verifyRes = await fetch('/api/pi/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: authResult.accessToken }),
  });

  if (!verifyRes.ok) {
    return {
      uid: authResult.user.uid,
      username: authResult.user.username,
      verified: false,
    };
  }

  const verifiedData = (await verifyRes.json()) as {
    uid?: string;
    username?: string;
    verified?: boolean;
  };

  return {
    uid: verifiedData.uid || authResult.user.uid,
    username: verifiedData.username || authResult.user.username,
    verified: Boolean(verifiedData.verified),
  };
}
