import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine and shared packages ship TypeScript source, not build output.
  // That keeps the monorepo free of a build step between editing the engine
  // and seeing the change in the app.
  transpilePackages: ["@penpaper/engine", "@penpaper/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
