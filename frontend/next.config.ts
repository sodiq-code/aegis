import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only use standalone output for Docker/local production, not Vercel
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "z-cdn.chatglm.cn",
      },
    ],
  },
};

export default nextConfig;
