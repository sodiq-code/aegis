import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only use standalone output for Docker/local production, not Vercel
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
