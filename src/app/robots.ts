import type { MetadataRoute } from "next";
import { env } from "@/server/env";

export default function robots(): MetadataRoute.Robots {
  const base = env.APP_URL.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/me", "/settings", "/notifications", "/business", "/create", "/events/new", "/*/edit", "/*/manage", "/login", "/register", "/forgot-password", "/reset-password"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
