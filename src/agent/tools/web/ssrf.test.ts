import { describe, it, expect } from "vitest";
import { isPrivateIpAddress, isBlockedHostname, SsrfBlockedError } from "./ssrf.js";

describe("ssrf", () => {
  describe("isPrivateIpAddress", () => {
    describe("IPv4 private ranges", () => {
      it("should block 10.x.x.x range", () => {
        expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
        expect(isPrivateIpAddress("10.255.255.255")).toBe(true);
        expect(isPrivateIpAddress("10.50.100.200")).toBe(true);
      });

      it("should block 172.16.x.x - 172.31.x.x range", () => {
        expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
        expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
        expect(isPrivateIpAddress("172.20.100.50")).toBe(true);
      });

      it("should not block 172.15.x.x or 172.32.x.x", () => {
        expect(isPrivateIpAddress("172.15.0.1")).toBe(false);
        expect(isPrivateIpAddress("172.32.0.1")).toBe(false);
      });

      it("should block 192.168.x.x range", () => {
        expect(isPrivateIpAddress("192.168.0.1")).toBe(true);
        expect(isPrivateIpAddress("192.168.255.255")).toBe(true);
        expect(isPrivateIpAddress("192.168.1.100")).toBe(true);
      });

      it("should block 127.x.x.x loopback range", () => {
        expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
        expect(isPrivateIpAddress("127.255.255.255")).toBe(true);
        expect(isPrivateIpAddress("127.0.0.0")).toBe(true);
      });

      it("should block 169.254.x.x link-local range", () => {
        expect(isPrivateIpAddress("169.254.0.1")).toBe(true);
        expect(isPrivateIpAddress("169.254.255.255")).toBe(true);
      });

      it("should block 0.x.x.x range", () => {
        expect(isPrivateIpAddress("0.0.0.0")).toBe(true);
        expect(isPrivateIpAddress("0.0.0.1")).toBe(true);
      });

      it("should block 100.64.x.x - 100.127.x.x CGNAT range", () => {
        expect(isPrivateIpAddress("100.64.0.1")).toBe(true);
        expect(isPrivateIpAddress("100.127.255.255")).toBe(true);
        expect(isPrivateIpAddress("100.100.50.25")).toBe(true);
      });

      it("should not block 100.63.x.x or 100.128.x.x", () => {
        expect(isPrivateIpAddress("100.63.0.1")).toBe(false);
        expect(isPrivateIpAddress("100.128.0.1")).toBe(false);
      });

      it("should allow public IPs", () => {
        expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
        expect(isPrivateIpAddress("1.1.1.1")).toBe(false);
        expect(isPrivateIpAddress("203.0.113.50")).toBe(false);
        expect(isPrivateIpAddress("198.51.100.100")).toBe(false);
      });
    });

    describe("IPv6 addresses", () => {
      it("should block loopback ::1", () => {
        expect(isPrivateIpAddress("::1")).toBe(true);
        expect(isPrivateIpAddress("::")).toBe(true);
      });

      it("should block fe80: link-local", () => {
        expect(isPrivateIpAddress("fe80::1")).toBe(true);
        expect(isPrivateIpAddress("fe80:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
      });

      it("should block fc/fd unique local addresses", () => {
        expect(isPrivateIpAddress("fc00::1")).toBe(true);
        expect(isPrivateIpAddress("fd00::1")).toBe(true);
        expect(isPrivateIpAddress("fdab:cdef:1234::1")).toBe(true);
      });

      it("should block fec0: site-local (deprecated)", () => {
        expect(isPrivateIpAddress("fec0::1")).toBe(true);
      });
    });

    describe("IPv4-mapped IPv6 addresses", () => {
      it("should block ::ffff:10.x.x.x", () => {
        expect(isPrivateIpAddress("::ffff:10.0.0.1")).toBe(true);
        expect(isPrivateIpAddress("::ffff:10.255.255.255")).toBe(true);
      });

      it("should block ::ffff:127.0.0.1", () => {
        expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
      });

      it("should block ::ffff:192.168.x.x", () => {
        expect(isPrivateIpAddress("::ffff:192.168.1.1")).toBe(true);
      });

      it("should allow ::ffff:public IPs", () => {
        expect(isPrivateIpAddress("::ffff:8.8.8.8")).toBe(false);
        expect(isPrivateIpAddress("::ffff:1.1.1.1")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle bracketed IPv6", () => {
        expect(isPrivateIpAddress("[::1]")).toBe(true);
        expect(isPrivateIpAddress("[fe80::1]")).toBe(true);
      });

      it("should handle whitespace", () => {
        expect(isPrivateIpAddress("  10.0.0.1  ")).toBe(true);
        expect(isPrivateIpAddress("\t192.168.1.1\n")).toBe(true);
      });

      it("should handle case insensitivity", () => {
        expect(isPrivateIpAddress("FE80::1")).toBe(true);
        expect(isPrivateIpAddress("FC00::1")).toBe(true);
      });

      it("should return false for empty string", () => {
        expect(isPrivateIpAddress("")).toBe(false);
        expect(isPrivateIpAddress("  ")).toBe(false);
      });

      it("should return false for invalid IPs", () => {
        expect(isPrivateIpAddress("not-an-ip")).toBe(false);
        expect(isPrivateIpAddress("256.256.256.256")).toBe(false);
        expect(isPrivateIpAddress("192.168.1")).toBe(false);
      });
    });
  });

  describe("isBlockedHostname", () => {
    it("should block localhost", () => {
      expect(isBlockedHostname("localhost")).toBe(true);
      expect(isBlockedHostname("LOCALHOST")).toBe(true);
      expect(isBlockedHostname("LocalHost")).toBe(true);
    });

    it("should block metadata.google.internal", () => {
      expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    });

    it("should block .localhost subdomains", () => {
      expect(isBlockedHostname("foo.localhost")).toBe(true);
      expect(isBlockedHostname("sub.domain.localhost")).toBe(true);
    });

    it("should block .local domains", () => {
      expect(isBlockedHostname("myhost.local")).toBe(true);
      expect(isBlockedHostname("printer.local")).toBe(true);
    });

    it("should block .internal domains", () => {
      expect(isBlockedHostname("myservice.internal")).toBe(true);
      expect(isBlockedHostname("app.internal")).toBe(true);
    });

    it("should handle trailing dots", () => {
      expect(isBlockedHostname("localhost.")).toBe(true);
      expect(isBlockedHostname("foo.local.")).toBe(true);
    });

    it("should allow public domains", () => {
      expect(isBlockedHostname("google.com")).toBe(false);
      expect(isBlockedHostname("github.com")).toBe(false);
      expect(isBlockedHostname("example.org")).toBe(false);
    });

    it("should return false for empty hostname", () => {
      expect(isBlockedHostname("")).toBe(false);
      expect(isBlockedHostname("  ")).toBe(false);
    });
  });

  describe("SsrfBlockedError", () => {
    it("should be an instance of Error", () => {
      const error = new SsrfBlockedError("test message");
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("test message");
      expect(error.name).toBe("SsrfBlockedError");
    });
  });
});
