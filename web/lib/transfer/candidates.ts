/**
 * A copy of a host candidate that names this device by `address` instead of the `<uuid>.local`
 * name browsers put there. Many networks won't resolve those names between two devices, which
 * leaves a direct transfer with nothing to dial. The server says which address a page reaches it
 * from, as its STUN responder would, but through a reverse proxy too, which carries no UDP. The
 * port is the candidate's own, so the copy is a place the other device can actually reach.
 * Anything but a UDP host candidate behind such a name has no copy.
 */
export function withAddress(candidate: RTCIceCandidateInit, address: string): RTCIceCandidateInit | null {
  // candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> …
  const parts = candidate.candidate?.split(" ");
  if (!parts || parts.length < 8 || parts[6] !== "typ" || parts[7] !== "host") return null;
  if (parts[2].toLowerCase() !== "udp" || !parts[4].endsWith(".local")) return null;
  parts[4] = address;
  return { ...candidate, candidate: parts.join(" ") };
}
