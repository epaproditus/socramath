import type { NextConfig } from "next";
import path from "path";

const tldrawAliases = {
  tldraw: path.resolve(__dirname, "node_modules/tldraw"),
  "@tldraw/editor": path.resolve(__dirname, "node_modules/@tldraw/editor"),
  "@tldraw/state": path.resolve(__dirname, "node_modules/@tldraw/state"),
  "@tldraw/state-react": path.resolve(__dirname, "node_modules/@tldraw/state-react"),
  "@tldraw/store": path.resolve(__dirname, "node_modules/@tldraw/store"),
  "@tldraw/tlschema": path.resolve(__dirname, "node_modules/@tldraw/tlschema"),
  "@tldraw/utils": path.resolve(__dirname, "node_modules/@tldraw/utils"),
  "@tldraw/validate": path.resolve(__dirname, "node_modules/@tldraw/validate"),
};

const nextConfig: NextConfig = {
  transpilePackages: Object.keys(tldrawAliases),
  experimental: {
    turbo: {
      resolveAlias: tldrawAliases,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...tldrawAliases,
    };
    return config;
  },
};

export default nextConfig;
