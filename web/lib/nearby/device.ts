/** How this device appears to others on the network, kept across visits. */
export interface Device {
  id: string;
  name: string;
}

const KEY = "flux.device";
const MAX_NAME = 40;

let current: Device | undefined;

/**
 * A starting name taken from the platform. It is only a label — nothing behaves differently
 * because of it — and a household has more than one of each, so a short tag from the id
 * keeps them apart until someone names them properly.
 */
export function defaultName(userAgent: string, id: string): string {
  const kind = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? /Mobile/.test(userAgent)
          ? "Android phone"
          : "Android tablet"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows PC"
            : /Linux|CrOS/.test(userAgent)
              ? "Computer"
              : "Device";
  return `${kind} ${id.slice(0, 3).toUpperCase()}`;
}

// randomUUID needs a secure context, and plain-HTTP LAN deployments aren't one.
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getDevice(): Device {
  if (current) return current;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Device | null;
    if (stored?.id && stored.name) return (current = stored);
  } catch {
    // Unreadable or unavailable; a fresh identity follows.
  }
  const id = randomId();
  return save({ id, name: defaultName(navigator.userAgent, id) });
}

export function renameDevice(name: string): Device {
  const clean = name.trim().slice(0, MAX_NAME);
  return clean ? save({ ...getDevice(), name: clean }) : getDevice();
}

function save(device: Device): Device {
  current = device;
  try {
    localStorage.setItem(KEY, JSON.stringify(device));
  } catch {
    // Private mode: the identity lasts as long as this tab.
  }
  return device;
}
