import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine and shared packages ship TypeScript source, not build output.
  // That keeps the monorepo free of a build step between editing the engine
  // and seeing the change in the app.
  transpilePackages: ["@penpaper/engine", "@penpaper/shared"],
  // The Kafka client reaches for a native checksum addon, which cannot be
  // bundled into a route handler's ESM chunk. Leaving it external lets Node
  // load it the way it was built to be loaded; the worker process imports the
  // same package directly and never goes through the bundler at all.
  serverExternalPackages: ["@platformatic/kafka"],
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating "N" badge is a development aid, not part of the product. It
  // overlays the board in the corner the dock and menus live in, and every
  // screenshot of the app becomes a screenshot of Next.js. Errors still show.
  devIndicators: false,
};

export default nextConfig;
