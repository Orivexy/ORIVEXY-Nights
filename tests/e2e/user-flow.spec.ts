import { expect, test } from "@playwright/test";
import { PASSWORD, TONIGHT, VENUE, createPostApi, expectToast, jpeg, login, registerApi, uniqueName } from "./helpers";

test.describe.configure({ mode: "serial" });

test("complete user journey", async ({ page, browser }) => {
  const name = uniqueName("u");

  // Another real user with a post, created through the API in its own session.
  const otherCtx = await browser.newContext();
  const other = await registerApi(otherCtx.request);
  const otherPost = await createPostApi(otherCtx.request, `Post de ${other.name}`);

  // 1. Register
  await page.goto("/register");
  await page.getByLabel("Nombre", { exact: true }).fill("E2E Tester");
  await page.getByLabel("Usuario").fill(name);
  await page.getByLabel("Email").fill(`${name}@example.com`);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.waitForURL("/");

  // 2. Log out and back in
  await page.goto("/settings");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/settings"));
  await login(page, `${name}@example.com`);

  // 3. Edit profile
  await page.goto("/settings");
  await page.getByLabel("Bio").fill("Techno y noches largas");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expectToast(page, /guardad|actualizad/i);

  // 4. Search
  await page.goto("/search?q=noche%20prueba");
  await expect(page.getByText(TONIGHT.title).first()).toBeVisible();

  // 5-6. Open event: going + save
  await page.goto(`/events/${TONIGHT.slug}`);
  await page.getByRole("button", { name: /^Voy$/ }).first().click();
  await expect(page.getByRole("button", { name: /Vas/ }).first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Guardado", exact: true }).first()).toBeVisible();

  // 7. Saved plans list it
  await page.goto("/me");
  await page.getByRole("tab", { name: "Guardados" }).click();
  await expect(page.getByText(TONIGHT.title).first()).toBeVisible();

  // 8. Venue: follow
  await page.goto(`/venues/${VENUE.slug}`);
  await page.getByRole("button", { name: "Seguir" }).first().click();
  await expect(page.getByRole("button", { name: "Siguiendo" }).first()).toBeVisible();

  // 9. Publish a photo
  await page.goto("/create/post?type=photo");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "night.jpg", mimeType: "image/jpeg", buffer: await jpeg() });
  await expect(page.getByText("Portada")).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Anoche en Gràcia 🔥").fill(`Mi post ${name}`);
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.waitForURL(/\/social\?post=/);
  await expect(page.getByText(`Mi post ${name}`).first()).toBeVisible();

  // 10. Like + comment someone else's post
  await page.goto(`/social?post=${otherPost.id}`);
  const post = page.locator("article").filter({ hasText: `Post de ${other.name}` }).first();
  await post.getByRole("button", { name: "Me gusta" }).click();
  await expect(post.getByRole("button", { name: "Quitar like" })).toBeVisible();
  await post.getByRole("button", { name: "Comentarios" }).click();
  const dialog = page.getByRole("dialog", { name: "Comentarios" });
  await dialog.getByLabel("Comentario").fill(`¡Qué noche! ${name}`);
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(dialog.getByText(`¡Qué noche! ${name}`)).toBeVisible();
  await page.keyboard.press("Escape");

  // 11. Follow the other user
  await page.goto(`/u/${other.name}`);
  await page.getByRole("button", { name: "Seguir" }).click();
  await expect(page.getByRole("button", { name: "Siguiendo" })).toBeVisible();

  // 12. The other user got real notifications (follow, like, comment)
  await expect
    .poll(async () => ((await (await otherCtx.request.get("/api/notifications")).json()) as { items: Array<{ type: string }> }).items.map((n) => n.type))
    .toEqual(expect.arrayContaining(["FOLLOW", "POST_LIKE", "POST_COMMENT"]));

  // 13. Report the other user's post
  await page.goto(`/social?post=${otherPost.id}`);
  const again = page.locator("article").filter({ hasText: `Post de ${other.name}` }).first();
  await again.getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("button", { name: "Reportar publicación" }).click();
  const report = page.getByRole("dialog");
  await report.getByRole("button", { name: "Spam" }).click();
  await report.getByRole("button", { name: "Enviar reporte" }).click();
  await expectToast(page, /revisará|Gracias/i);

  // 14. Block: their content disappears and they can't interact
  await page.goto(`/u/${other.name}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("button", { name: "Bloquear" }).click();
  await expect(page.getByRole("button", { name: "Desbloquear" }).first()).toBeVisible();
  const blockedGet = await page.request.get(`/api/posts/${otherPost.id}`);
  expect(blockedGet.status()).toBe(404);
  const myPosts = (await (await page.request.get(`/api/users/${other.id}/posts`)).json()) as { items: unknown[] };
  expect(myPosts.items).toHaveLength(0);
  const followBack = await otherCtx.request.put(`/api/users/${(await (await page.request.get("/api/auth/me")).json()).user.id}/follow`, { data: { following: true } });
  expect(followBack.status()).toBe(403);
  await page.goto("/settings");
  await expect(page.getByText(`@${other.name}`).first()).toBeVisible();

  // 15. Create an event: saved as a draft, previewed, then sent (new accounts go to review)
  await page.goto("/events/new");
  await page.getByLabel("Título").fill(`Fiesta ${name}`);
  await page.getByLabel("Nombre del lugar").fill("Plaça de la Virreina");
  await page.getByLabel("Artistas / DJs").fill(`DJ ${name}, Otra Artista`);
  await page.getByRole("button", { name: "Guardar y ver vista previa" }).click();
  await page.waitForURL(/\/events\/fiesta-/);
  await expect(page.getByText(/Vista previa del borrador/)).toBeVisible();
  await expect(page.getByRole("link", { name: `DJ ${name}` })).toBeVisible();
  // Drafts are private: visitors get the not-found page, never the draft (API: 404).
  const anon = await browser.newContext();
  const draftHtml = await (await anon.request.get(page.url())).text();
  expect(draftHtml).not.toContain(`DJ ${name}`);
  const draftSlug = new URL(page.url()).pathname.split("/").pop()!;
  const draftId = ((await (await page.request.get(`/api/events?q=${encodeURIComponent(name)}`)).json()) as { items: Array<{ id: string }> }).items[0]?.id;
  expect(draftId).toBeUndefined(); // drafts are not listed
  expect(draftSlug).toMatch(/^fiesta-/);
  await anon.close();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText(/Pendiente de revisión/)).toBeVisible();

  // 16. Change password, then log in with the new one
  await page.goto("/settings");
  await page.getByLabel("Contraseña actual").fill(PASSWORD);
  await page.getByLabel("Nueva contraseña").fill("nueva-pass-987");
  await page.getByLabel("Repite la contraseña").fill("nueva-pass-987");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expectToast(page, /contraseña/i);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/settings"));
  await login(page, `${name}@example.com`, "nueva-pass-987");

  // 17. Profile shows the post; notifications page loads
  await page.goto(`/u/${name}`);
  await expect(page.getByRole("heading", { name: "E2E Tester" })).toBeVisible();
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notificaciones" })).toBeVisible();
  await otherCtx.close();
});

test("delete account removes the user and their session", async ({ page }) => {
  const u = await registerApi(page.request);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Eliminar cuenta…" }).click();
  await page.getByLabel(`Escribe «${u.name}» para confirmar`).fill(u.name);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await page.waitForURL("/");
  const me = (await (await page.request.get("/api/auth/me")).json()) as { user: unknown };
  expect(me.user).toBeNull();
  const res = await page.request.post("/api/auth/login", { data: { email: u.email, password: PASSWORD } });
  expect(res.status()).toBe(401);
});
