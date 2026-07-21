/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the Docker runtime image.
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
  // Baseline hardening headers. No CSP: this service is a JSON API for the
  // mobile client, with no rendered UI surface a CSP would protect.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Render terminates TLS, so HTTPS is always available upstream —
          // tell clients never to try the plaintext port again.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Stops a JSON response being re-interpreted as HTML/script if it is
          // ever fetched into a browser context.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
