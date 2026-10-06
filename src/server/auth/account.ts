import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { ApiError, badRequest } from "../errors";
import { hashPassword, verifyPassword } from "./password";
import { destroyAllSessions } from "./session";
import { EmailNotConfiguredError, emailAvailable, passwordResetEmail, sendEmail } from "../email";
import { deleteImage } from "../media/image";
import { storage } from "../storage";

/**
 * Account self-service: password reset by email, password change and
 * account deletion. Tokens are random, single-use, expire after 1 hour and
 * only their SHA-256 is stored. Responses never reveal whether an email is
 * registered.
 */
const RESET_TTL_MS = 60 * 60_000;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function requestPasswordReset(email: string) {
  if (!emailAvailable()) throw new ApiError(503, "La recuperación de contraseña por email no está disponible en este servidor. Contacta con el administrador.", "EMAIL_NOT_CONFIGURED");
  const user = await db.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (!user || user.status !== "ACTIVE") return; // same response either way
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    // Only the latest link works.
    db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } }),
  ]);
  const link = `${env.APP_URL}/reset-password?token=${token}`;
  try {
    await sendEmail({ to: email, ...passwordResetEmail(link) });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) throw new ApiError(503, err.message, "EMAIL_NOT_CONFIGURED");
    console.error("[email] password reset failed", err);
    throw new ApiError(502, "No se pudo enviar el email. Inténtalo más tarde.", "EMAIL_FAILED");
  }
}

export async function resetPassword(token: string, password: string) {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true, userId: true, expiresAt: true, usedAt: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest("El enlace no es válido o ha caducado. Pide uno nuevo.");
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  await destroyAllSessions(row.userId); // log out every device
}

export async function changePassword(userId: string, currentPassword: string | undefined, password: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (user.passwordHash && !(await verifyPassword(currentPassword ?? "", user.passwordHash))) {
    throw badRequest("La contraseña actual no es correcta", { currentPassword: "Contraseña incorrecta" });
  }
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  // Other devices must sign in again; the caller issues a fresh session for this one.
  await destroyAllSessions(userId);
}

/** Deletes the account and everything it owns (posts, comments, likes…). */
export async function deleteAccount(userId: string, confirm: string, password: string | undefined) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, role: true, profile: { select: { username: true } }, _count: { select: { orders: true } } },
  });
  if (confirm.trim().toLowerCase() !== user.profile?.username) throw badRequest("Escribe tu nombre de usuario para confirmar", { confirm: "No coincide" });
  if (user.passwordHash && !(await verifyPassword(password ?? "", user.passwordHash))) throw badRequest("Contraseña incorrecta", { password: "Contraseña incorrecta" });
  if (user.role === "ADMIN" && (await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } })) <= 1) {
    throw badRequest("Eres el único administrador: nombra a otro antes de borrar tu cuenta");
  }
  if (user._count.orders > 0) throw badRequest("Tu cuenta tiene pedidos asociados: escríbenos para eliminarla conservando los datos fiscales obligatorios");
  // Files are not rows: collect them before the cascade removes the references.
  const [photos, videos] = await Promise.all([
    db.photo.findMany({ where: { uploaderId: userId }, select: { key: true } }),
    db.video.findMany({ where: { uploaderId: userId }, select: { key: true, posterKey: true } }),
  ]);
  await db.$transaction([
    // Metrics stay as anonymous counts.
    db.interaction.updateMany({ where: { userId }, data: { userId: null } }),
    db.user.delete({ where: { id: userId } }),
  ]);
  await Promise.allSettled([
    ...photos.map((p) => deleteImage(p.key)),
    ...videos.map(async (v) => {
      await storage.delete([v.key]);
      if (v.posterKey) await deleteImage(v.posterKey);
    }),
  ]);
}
