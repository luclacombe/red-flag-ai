import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@redflag/shared",
    "@redflag/db",
    "@redflag/api",
    "@redflag/agents",
  ],
};

export default nextConfig;
