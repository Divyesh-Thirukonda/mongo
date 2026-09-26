import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false, devIndicators: false, output: "standalone",
  // Generated srcDoc frames may execute their own code, but cannot navigate to external sites.
  async headers() { return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-src 'self'" }] }]; },
};
export default config;
