// The machine endpoints' shared pieces that need no route: the capped body
// reader and the registration bucket an address is charged to.

import { describe, expect, it } from "vitest";

import { addressBucket, readBodyCapped } from "./http";

describe("addressBucket", () => {
  it("keeps IPv4 addresses and the non-address fallbacks as they are", () => {
    expect(addressBucket("198.51.100.7")).toBe("198.51.100.7");
    expect(addressBucket("direct")).toBe("direct");
    expect(addressBucket("unknown")).toBe("unknown");
  });

  it("keys IPv6 addresses on their /64, in any spelling", () => {
    expect(addressBucket("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(addressBucket("2001:0db8:0001:0002:ffff:eeee:dddd:cccc")).toBe("2001:db8:1:2::/64");
    expect(addressBucket("[2001:DB8:1:2:0:0:0:9]")).toBe("2001:db8:1:2::/64");
    expect(addressBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(addressBucket("::1")).toBe("0:0:0:0::/64");
    expect(addressBucket("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(addressBucket("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });

  it("treats an IPv4-mapped address as its IPv4", () => {
    expect(addressBucket("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(addressBucket("::ffff:c633:6407")).toBe("198.51.100.7");
  });

  it("leaves anything malformed as it is", () => {
    for (const raw of ["1:2:3", "1::2::3", "gggg::1", "1:2:3:4:5:6:7:8:9", "::ffff:300.1.1.1"]) expect(addressBucket(raw)).toBe(raw);
  });
});

describe("readBodyCapped", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("http://x/", { method: "POST", body, headers, duplex: "half" } as RequestInit & { duplex: "half" });

  it("reads a body up to the limit, counted in bytes", async () => {
    expect(await readBodyCapped(post("a".repeat(16)), 16)).toBe("a".repeat(16));
    expect(await readBodyCapped(post("é".repeat(8)), 16)).toBe("é".repeat(8));
    expect(await readBodyCapped(post("é".repeat(9)), 16)).toBeNull();
    expect(await readBodyCapped(post(null), 16)).toBe("");
  });

  it("refuses a declared length over the limit, or a malformed one, without reading", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1));
      },
    });
    expect(await readBodyCapped(post(stream, { "content-length": "17" }), 16)).toBeNull();
    expect(pulled).toBeLessThanOrEqual(1); // at most the stream's own first pull, never by the reader
    expect(await readBodyCapped(post("ab", { "content-length": "two" }), 16)).toBeNull();
  });
});
