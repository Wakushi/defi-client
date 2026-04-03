import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "kysely",
    "@dynamic-labs-wallet/node-evm",
    "@dynamic-labs-wallet/core",
  ],
};

export default nextConfig;
