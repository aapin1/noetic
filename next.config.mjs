/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the Docker runtime image.
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
