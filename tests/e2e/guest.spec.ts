import { expect, test } from "@playwright/test";
import { TONIGHT, TOMORROW, VENUE } from "./helpers";

test.describe("guest browsing", () => {
  test("home shows the map and the next events", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /¿A qué discoteca vas\?/ })).toBeVisible();
    await expect(page.getByRole("application", { name: "Mapa" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Próximamente" })).toBeVisible();
    await expect(page.getByText(TONIGHT.title).first()).toBeVisible();
    await expect(page.getByText(/Esta noche · Barcelona/i)).toBeVisible();
  });

  test("event detail and auth gate on 'Voy'", async ({ page }) => {
    await page.goto(`/events/${TONIGHT.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: TONIGHT.title })).toBeVisible();
    await page.getByRole("button", { name: /Voy/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("venue profile", async ({ page }) => {
    await page.goto(`/venues/${VENUE.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: VENUE.name })).toBeVisible();
    await expect(page.getByText("Próximos eventos")).toBeVisible();
    await expect(page.getByText(TOMORROW.title).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Gestionar ficha" })).toHaveCount(0);
  });

  test("the club list opens the map", async ({ page }) => {
    for (const path of ["/venues", "/discover"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/map$/);
    }
  });

  test("map shows the venue", async ({ page }) => {
    await page.goto("/map");
    const pins = page.locator(".nx-pin-place");
    await expect(pins.first()).toBeAttached();
    await pins.first().dispatchEvent("click");
    await expect(page.getByRole("link", { name: /Cómo llegar/ })).toBeVisible();
  });

  test("search finds venues and events (accent-insensitive)", async ({ page }) => {
    await page.goto("/search?q=prueba");
    await expect(page.getByText(VENUE.name).first()).toBeVisible();
    await page.goto(`/search?q=${encodeURIComponent("gracia")}`);
    await expect(page.getByText(VENUE.name).first()).toBeVisible();
  });

  test("empty feed shows a real empty state", async ({ page }) => {
    await page.goto("/social");
    await expect(page.locator("body")).not.toContainText(/lorem|demo/i);
  });

  test("admin and private pages redirect to login", async ({ page }) => {
    for (const path of ["/admin", "/settings", "/business", "/events/new", `/venues/${VENUE.slug}/manage`]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("password recovery explains when email is not configured", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("status").filter({ hasText: /no tiene configurado el envío de emails/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    const res = await page.request.post("/api/auth/password/forgot", { data: { email: "someone@example.com" } });
    expect(res.status()).toBe(503);
  });
});

test.describe("search engines", () => {
  test("sitemap lists public pages and robots keeps private ones out", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`/venues/${VENUE.slug}`);
    expect(sitemap).toContain(`/events/${TONIGHT.slug}`);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/admin/);
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("event pages carry schema.org data and share metadata", async ({ page }) => {
    await page.goto(`/events/${TONIGHT.slug}`);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(ld["@type"]).toBe("Event");
    expect(ld.name).toBe(TONIGHT.title);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(TONIGHT.title));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/events/${TONIGHT.slug}$`));
  });
});
