import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Build errors are checked in CI; this allows faster local iteration
    // but we keep it false for production quality
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
