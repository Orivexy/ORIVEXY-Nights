# Monetización (preparada, DESACTIVADA)

ORIVEXY NIGHTS funciona hoy como plataforma **gratuita**: no cobra, no pide tarjetas, no vende entradas, no crea suscripciones, no emite facturas y no muestra publicidad. El código y la base de datos están preparados para activar estas funciones más adelante sin rehacer la aplicación.

## Interruptores (solo servidor)

`src/server/monetization/flags.ts` lee variables de entorno. Cada función necesita el interruptor general **y** su flag. No se exponen al navegador ni se pueden cambiar desde el panel (que solo los muestra en `/admin/monetization`).

| Variable | Qué activa | Dónde está el código |
| --- | --- | --- |
| `MONETIZATION_ENABLED` | Interruptor general | `flags.ts` |
| `TICKETS_ENABLED` | Tipos de entrada, pedidos, pagos, reembolsos | `orders.ts`, `refunds.ts`, `payments.ts` |
| `PREMIUM_VENUES_ENABLED` | Planes PLAN_PREMIUM / PLAN_BUSINESS | `plans.ts`, `business.ts` |
| `SUBSCRIPTIONS_ENABLED` | Cobro recurrente de planes | modelo `Subscription` |
| `SPONSORED_CONTENT_ENABLED` | Promociones (destacado / patrocinado) | `promotions.ts` |
| `ADS_ENABLED` | Publicidad | `promotions.ts` (tipo `AD`) |
| `INVOICING_ENABLED` | Emisión de facturas | `invoices.ts` |

Con una función desactivada, la API responde `403 FEATURE_DISABLED` con un mensaje claro (p. ej. al crear un evento con `ticketing: "PLATFORM"` o al llamar a `POST /api/orders`).

## Pasos para activar la venta de entradas

1. Implementar `PaymentProvider` (`src/server/monetization/payments.ts`), p. ej. Stripe: `createCheckout`, `refund` y `parseWebhook` (verificando la firma).
2. Devolverlo desde `getPaymentProvider()` y configurar sus claves en variables de entorno.
3. Crear una regla activa en `/admin/monetization → Comisiones` (no hay porcentajes por defecto).
4. Crear `TicketType` para el evento y poner `ticketProvider = ORIVEXY NIGHTS`, `salesStatus = ON_SALE`.
5. `MONETIZATION_ENABLED=true` y `TICKETS_ENABLED=true`.

Los pagos y reembolsos **solo** cambian de estado en `POST /api/webhooks/payments/[provider]` (`applyProviderEvent`). No existe ninguna función para marcar algo como pagado o reembolsado a mano.

## Modelo de datos

- **Roles**: `USER`, `ORGANIZER`, `VENUE` (comerciales, sin permisos de staff), `MODERATOR`, `ADMIN`. Todas las comprobaciones pasan por `src/lib/roles.ts`.
- **BusinessProfile**: nombre comercial, contacto, verificación, estado comercial, plan, eventos, suscripciones, promociones y operaciones (`Transaction`). `BillingProfile` guarda los datos fiscales.
- **Event**: `pricing` (FREE/PAID), `currency`, `ticketProvider` (NONE/EXTERNAL/ORIVEXY NIGHTS), `ticketUrl`, `capacity`, `salesStartAt/EndAt`, `refundPolicy`, `salesStatus`, `businessId`, `promotionType`.
- **Venta**: `TicketType` → `Order` (+ `OrderItem`) → `Payment` → `Ticket`; `Refund` (total o parcial) y `Transaction` (libro de operaciones, solo inserción).
- **Comisiones**: `CommissionRule` en puntos básicos (100 = 1 %) por negocio o global; el cálculo está en `fees.ts` (función pura con tests).
- **Planes**: `Plan` + `Subscription`; las funciones de cada plan en `PLAN_FEATURES`.
- **Publicidad**: `Promotion` y el campo `promotionType` en eventos, locales y publicaciones. La UI muestra siempre la etiqueta (“Destacado”, “Patrocinado”, “Publicidad”) con `SponsorBadge`. `isFeatured` sigue siendo el destacado editorial gratuito.
- **Facturación**: `Invoice` + `InvoiceLine`; el número solo lo asigna un proveedor externo (`InvoicingProvider`).
- **Auditoría**: `AuditLog` registra automáticamente las acciones del panel (`route({ audit })`).

## Seguridad

- Precio, comisión, moneda, propietario, negocio e importe final se calculan siempre en el servidor. Los esquemas zod eliminan cualquier campo no previsto (`organizerId`, `total`, `price` de un pedido…).
- Pedidos: la propiedad forma parte de la consulta (`getOrder`), mismo 404 para “no existe” y “no es tuyo”.
- Datos financieros y comerciales del panel: solo `ADMIN` (páginas con `requireAdminPage`, APIs con `auth: "admin"`).
- Los propietarios solo pueden editar los datos de contacto de su negocio (`businessOwnerUpdateSchema`, estricto).
