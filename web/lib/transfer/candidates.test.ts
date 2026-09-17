import assert from "node:assert/strict";
import { test } from "vitest";
import { withAddress } from "./candidates";

const init = (candidate: string): RTCIceCandidateInit => ({ candidate, sdpMid: "0", sdpMLineIndex: 0 });

test("names a hidden host candidate by the address the server saw, keeping its port", () => {
  const hidden = init(
    "candidate:1467250027 1 udp 2122260223 d2d7e56d-f2f8-4287-98bf-92053a460113.local 55685 typ host generation 0 ufrag abcd",
  );
  assert.deepEqual(withAddress(hidden, "192.168.1.20"), {
    candidate: "candidate:1467250027 1 udp 2122260223 192.168.1.20 55685 typ host generation 0 ufrag abcd",
    sdpMid: "0",
    sdpMLineIndex: 0,
  });
});

test("leaves alone what already carries an address, or isn't a UDP host candidate", () => {
  for (const candidate of [
    "candidate:1 1 udp 2122260223 192.168.1.5 55685 typ host generation 0",
    "candidate:2 1 udp 1686052607 85.131.65.75 54296 typ srflx raddr 0.0.0.0 rport 0 generation 0",
    "candidate:3 1 tcp 1518280447 d2d7e56d-f2f8-4287-98bf-92053a460113.local 9 typ host tcptype active",
    "",
  ]) {
    assert.equal(withAddress(init(candidate), "192.168.1.20"), null, candidate);
  }
});
