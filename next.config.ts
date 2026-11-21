import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "pg", "nodemailer", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  poweredByHeader: false,
};

export default nextConfig;
