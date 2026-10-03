import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine and shared packages ship TypeScript source, not build output.
  // That keeps the monorepo free of a build step between editing the engine
  // and seeing the change in the app.
  transpilePackages: ["@penpaper/engine", "@penpaper/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating "N" badge is a development aid, not part of the product. It
  // overlays the board in the corner the dock and menus live in, and every
  // screenshot of the app becomes a screenshot of Next.js. Errors still show.
  devIndicators: false,
};

export default nextConfig;
