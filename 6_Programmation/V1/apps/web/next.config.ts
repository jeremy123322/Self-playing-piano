import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@spp/contracts", "@spp/database", "@spp/infrastructure", "@spp/midi"],
  serverExternalPackages: ["@node-rs/argon2", "mqtt", "postgres"],
  images: { unoptimized: true },
};

export default nextConfig;
