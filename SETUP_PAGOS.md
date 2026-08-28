# 💳 Guía de Configuración del Sistema de Pagos — HumanIA

> Última actualización: agosto 2026

---

## Índice

1. [Activar PayPal Subscriptions](#1-activar-paypal-subscriptions)
2. [Activar NOWPayments (cripto)](#2-activar-nowpayments-cripto)
3. [Activar usuarios manualmente](#3-activar-usuarios-manualmente-binance--efectivo--transferencia)
4. [Webhook de NOWPayments](#4-webhook-de-nowpayments)
5. [Endpoint de activación por API](#5-endpoint-de-activación-manual-por-api)

---

## 1. Activar PayPal Subscriptions

### Paso a paso

1. Ve a [developer.paypal.com](https://developer.paypal.com) e inicia sesión con tu cuenta PayPal de negocio.
2. En el menú lateral selecciona **Apps & Credentials**.
3. Asegúrate de estar en la pestaña **Live** (no Sandbox).
4. Haz clic en **Create App**:
   - Name: `HumanIA Pagos`
   - Type: **Merchant**
5. Copia el **Client ID** que aparece en pantalla.
6. Abre el archivo `.env` del proyecto y reemplaza:
   ```
   PAYPAL_CLIENT_ID=TU_CLIENT_ID_REAL_AQUÍ
   ```
7. Reinicia el servidor: `npm start` o `pm2 restart humaniabot`.

### Planes configurados

| Plan   | Precio  | Descripción           |
|--------|---------|-----------------------|
| member | $7/mes  | Acceso mensual básico |
| vip    | $20/mes | Acceso VIP ilimitado  |

> **Nota:** El frontend ya llama a `POST /api/payment/paypal/verify` al completar un pago.
> Solo necesitas el Client ID en el `.env`.

---

## 2. Activar NOWPayments (cripto)

### Paso a paso

1. Crea una cuenta en [nowpayments.io](https://nowpayments.io).
2. Completa la verificación de cuenta (KYB básico).
3. Ve a **Configuración → API Keys**.
4. Haz clic en **Generate API Key** y copia la clave.
5. Abre el archivo `.env` y reemplaza:
   ```
   NOWPAYMENTS_API_KEY=TU_API_KEY_REAL_AQUÍ
   ```
6. Reinicia el servidor.

NOWPayments admite +200 criptomonedas. El endpoint `POST /api/payment/crypto` crea la factura automáticamente.

> ⚠️ **Importante:** Configura el webhook antes de hacer pruebas en producción (ver sección 4).

---

## 3. Activar usuarios manualmente (Binance / efectivo / transferencia)

Cuando un usuario pague por cualquier método fuera de PayPal o cripto automático,
usa `admin_tool.js` para activarlo desde la terminal.

### Comandos disponibles

```bash
# Activar como VIP ($20/mes)
node admin_tool.js activate usuario@correo.com vip

# Activar como Member ($7/mes)
node admin_tool.js activate usuario@correo.com member

# Volver a free (cancelación o reembolso)
node admin_tool.js activate usuario@correo.com free

# Ver todos los usuarios y su plan actual
node admin_tool.js list

# Ver estadísticas globales (totales, ingresos estimados)
node admin_tool.js stats
```

### Flujo típico

```
Cliente: "Pagué por Binance, mi correo es ana@mail.com"
Tú:      Verificas el pago en Binance
Tú:      node admin_tool.js activate ana@mail.com vip

✅  Usuario actualizado exitosamente
   📧 Email : ana@mail.com
   👑 Plan  : VIP
   🕐 Fecha : 27/8/2026, 10:15:00
```

Usa `node admin_tool.js list` para confirmar el cambio antes de notificar al cliente.

---

## 4. Webhook de NOWPayments

Cuando un pago de cripto se confirma, NOWPayments notifica a tu servidor automáticamente.

### URL del Webhook

```
https://humaniabot.com/api/webhook/nowpayments
```

### Configuración en NOWPayments

1. Ve a tu panel en [nowpayments.io](https://nowpayments.io).
2. Navega a **Configuración → Webhooks / IPN**.
3. Pega la URL:
   ```
   https://humaniabot.com/api/webhook/nowpayments
   ```
4. Guarda los cambios.

> ⚠️ **Advertencia:** El webhook debe apuntar al dominio en producción con HTTPS.
> NOWPayments rechaza URLs con HTTP o IP directa.

---

## 5. Endpoint de activación manual por API

Si necesitas activar usuarios desde un sistema externo (CRM, bot de Telegram, etc.),
puedes llamar directamente al endpoint REST.

| Campo        | Valor                                       |
|--------------|---------------------------------------------|
| Método       | `POST`                                      |
| URL          | `https://humaniabot.com/api/admin/activate` |
| Content-Type | `application/json`                          |

### Body (JSON)

```json
{
  "secret": "HumanIA_Admin_2026",
  "email":  "usuario@correo.com",
  "plan":   "vip"
}
```

### Planes válidos

| Valor    | Descripción             |
|----------|-------------------------|
| `free`   | Plan gratuito (10 msgs) |
| `member` | Plan $7/mes             |
| `vip`    | Plan $20/mes            |

### Ejemplo con curl

```bash
curl -X POST https://humaniabot.com/api/admin/activate \
  -H "Content-Type: application/json" \
  -d '{"secret":"HumanIA_Admin_2026","email":"cliente@mail.com","plan":"vip"}'
```

### Respuesta esperada

```json
{ "message": "¡Éxito! El usuario cliente@mail.com ahora es VIP." }
```

> 🔒 **Seguridad:** El valor `ADMIN_SECRET` en `.env` es la contraseña de este endpoint.
> Nunca lo compartas públicamente ni lo incluyas en el código frontend.

---

## Resumen de variables `.env`

```env
ADMIN_SECRET=HumanIA_Admin_2026          # secreto para /api/admin/activate
PAYPAL_CLIENT_ID=<tu_client_id_paypal>   # developer.paypal.com → Live → Apps
NOWPAYMENTS_API_KEY=<tu_api_key>         # nowpayments.io → API Keys
```

---

## Cobrar antes de tener PayPal configurado

Si aún no tienes PayPal/NOWPayments listos, cobra así:

1. **Binance Pay** — comparte tu QR de Binance Pay, el cliente te paga en USDT
2. **Zelle / PayPal personal** — para clientes en USA
3. **Transferencia bancaria** — para Venezuela

Luego activas manualmente con `node admin_tool.js activate email@cliente.com vip`

No hay excusa para esperar — puedes cobrar HOY de forma manual y activar el usuario en 10 segundos.
