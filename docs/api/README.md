# Documentación funcional de la API Fenix CRM

Esta carpeta documenta la API backend de Fenix CRM desde el punto de vista funcional y de lógica de negocio. Está pensada para ser migrada a Confluence manteniendo una estructura por features.

## Índice recomendado para Confluence

1. [Arquitectura general](./00-arquitectura-general.md)
2. [Modelo de datos y conceptos centrales](./01-modelo-datos-y-conceptos.md)
3. [Autenticación, usuarios y cuentas](./02-auth-usuarios-cuentas.md)
4. [Leads: nombres, estados, labels y recordatorios](./03-leads-nombres-labels-recordatorios.md)
5. [Mensajería y conversaciones](./04-mensajeria-conversaciones.md)
6. [Webhooks YCloud y sincronización WhatsApp](./05-webhooks-ycloud.md)
7. [Campañas automáticas: reenganche y repetición](./06-campanas-automaticas.md)
8. [Dashboard, métricas, media y clichés](./07-dashboard-media-cliches.md)
9. [Operación, jobs, colas y variables de entorno](./08-operacion-jobs-colas-env.md)
10. [Resumen de endpoints](./09-resumen-endpoints.md)

## Alcance

Incluye:

- flujos funcionales principales;
- reglas de negocio por feature;
- entidades relevantes de base de datos;
- eventos, webhooks, workers y schedulers;
- colas RabbitMQ y retries;
- criterios de idempotencia y prevención de duplicados.

No incluye:

- documentación de infraestructura cloud externa;
- manual de usuario de la SPA;
- credenciales o secretos reales;
- payloads completos de proveedores salvo estructuras de referencia.

## Convenciones

- `accountId`: cuenta comercial de Fenix, asociada a un número WhatsApp/YCloud.
- `leadId`: cliente/contacto final dentro de una cuenta.
- `phoneE164`: teléfono normalizado en formato E.164, por ejemplo `+34600000000`.
- `template`: plantilla WhatsApp aprobada en YCloud.
- `worker`: proceso backend que consume colas RabbitMQ.
- `scheduler`: cron job que corre en el proceso API y publica jobs en RabbitMQ.

