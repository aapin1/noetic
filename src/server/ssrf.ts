import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { AppError } from "@/lib/api";

/**
 * Guards the server-side fetchers against being pointed at our own network.
 *
 * The capture pipeline fetches URLs the user supplies. Without this check that
 * is a server-side request forgery primitive: `http://169.254.169.254/` reaches
 * the cloud metadata service, `http://127.0.0.1:5432/` and internal hostnames
 * reach services that are only reachable from inside the deployment. Zod's
 * `.url()` accepts all of them — it validates syntax, not destination.
 *
 * Two layers, because either alone is bypassable:
 *   1. Protocol allow-list, so `file:`, `gopher:`, `data:` can't be used at all.
 *   2. DNS resolution, then a check of every resolved address. Checking the
 *      hostname text alone is defeated by any attacker-controlled domain with
 *      an A record pointing at 127.0.0.1.
 */

/** Reserved IPv4 ranges, as [first octet predicate] over the parsed octets. */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // unparseable — refuse rather than guess
  }

  const [a, b] = parts as [number, number, number, number];

  return (
    a === 0 ||                              // "this network"
    a === 10 ||                             // private
    a === 127 ||                            // loopback
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link-local — cloud metadata lives here
    (a === 172 && b >= 16 && b <= 31) ||    // private
    (a === 192 && b === 0) ||               // IETF protocol assignments
    (a === 192 && b === 168) ||             // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                                // multicast + reserved + broadcast
  );
}

/**
 * Expands any IPv6 spelling to its 8 numeric groups, or null if unparseable.
 *
 * This has to be done properly rather than by matching on the text: `new URL()`
 * canonicalizes what the caller wrote, so `::ffff:127.0.0.1` arrives as
 * `::ffff:7f00:1`. A check that only recognized the dotted-quad spelling would
 * wave the hex spelling of the very same loopback address straight through.
 */
function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0]!; // drop any zone index

  // A trailing dotted quad (::ffff:127.0.0.1) becomes two hex groups.
  const embedded = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded) {
    const octets = embedded[1]!.split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    text = `${text.slice(0, embedded.index)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => parseInt(group, 16));

  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];

  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail]
      : head;

  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) {
    return null;
  }

  return groups;
}

function isPrivateIPv6(address: string): boolean {
  const groups = expandIPv6(address);
  if (!groups) return true; // unparseable — refuse rather than guess

  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded v4 address, whichever way
  // it was spelled.
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMapped) {
    const [g6, g7] = [groups[6]!, groups[7]!];
    return isPrivateIPv4(
      `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`,
    );
  }

  const allZeroExceptLast = groups.slice(0, 7).every((g) => g === 0);
  if (allZeroExceptLast && (groups[7] === 1 || groups[7] === 0)) return true; // ::1, ::

  const leading = groups[0]!;
  if ((leading & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((leading & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  return false;
}

function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) return isPrivateIPv4(address);
  if (isIPv6(address)) return isPrivateIPv6(address);
  return true; // not an address we understand — refuse
}

const BLOCKED_URL = "That link can't be fetched.";

/**
 * Throws unless `input` is a public http(s) URL. Returns the parsed URL.
 *
 * Deliberately vague in its user-facing message: a precise error ("that host is
 * internal") turns this endpoint into a scanner for our private network.
 */
export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("INVALID_URL", BLOCKED_URL, 422);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("INVALID_URL", BLOCKED_URL, 422);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // An IP literal never needs resolving, and must not be handed to the resolver.
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new AppError("INVALID_URL", BLOCKED_URL, 422);
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    // Unresolvable. Let the fetch fail on its own terms rather than inventing a
    // different error for what is usually just a dead link.
    return url;
  }

  // ALL resolved addresses must be public: a host with both a public and a
  // private record would otherwise be a coin flip.
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AppError("INVALID_URL", BLOCKED_URL, 422);
  }

  return url;
}
