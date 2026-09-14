import type { NextConfig } from "next";

type HostRewrite = {
  source: string;
  destination: string;
  has: { type: "host"; value: string }[];
};

function brandRewrites(host: string, directory: string, brandFiles: string[]): HostRewrite[] {
  const has = [{ type: "host" as const, value: host }];
  return [
    { source: "/", destination: `/storefronts/${directory}/index.html`, has },
    { source: "/index.html", destination: `/storefronts/${directory}/index.html`, has },
    { source: "/assets/:path*", destination: `/storefronts/${directory}/assets/:path*`, has },
    { source: "/shared/:path*", destination: "/storefronts/shared/:path*", has },
    ...brandFiles.map(file => ({
      source: `/${file}`,
      destination: `/storefronts/${directory}/${file}`,
      has,
    })),
  ];
}

const config: NextConfig = {
  async rewrites() {
    return [
      ...brandRewrites("(?:www\\.)?chefings\\.com", "chefings", ["config.js", "chefings.css"]),
      ...brandRewrites("(?:www\\.)?cozyinfants\\.com", "cozy-infants", ["config.js", "cozy.css"]),
      ...brandRewrites("(?:www\\.)?facejamas\\.com", "facejamas", [
        "config.js",
        "facejamas.css",
        "personalization.js",
        "policies.html",
      ]),
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "X-Frame-Options", value: "DENY" }]
            : []),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;
