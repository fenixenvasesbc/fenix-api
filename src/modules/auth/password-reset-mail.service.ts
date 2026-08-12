import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class PasswordResetMailService {
  private readonly logger = new Logger(PasswordResetMailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetEmail(input: { email: string; resetUrl: string }) {
    const transporter = this.getTransporter();
    const from =
      this.config.get<string>('SMTP_FROM') ||
      this.config.get<string>('SMTP_USER') ||
      'Fenix CRM <no-reply@fenixcrm.site>';
    const appName = this.config.get<string>('APP_NAME') || 'Fenix CRM';

    await transporter.sendMail({
      from,
      to: input.email,
      subject: `Restablecer contrasena - ${appName}`,
      text: [
        `Hola,`,
        '',
        `Recibimos una solicitud para restablecer la contrasena de tu cuenta en ${appName}.`,
        `Abre este enlace para crear una nueva contrasena:`,
        '',
        input.resetUrl,
        '',
        'Este enlace caduca pronto y solo puede usarse una vez.',
        'Si no solicitaste este cambio, puedes ignorar este correo.',
      ].join('\n'),
      html: `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Restablecer contrasena</title>
          </head>
          <body style="margin:0;padding:0;background:#09090b;font-family:Arial,Helvetica,sans-serif;color:#f9fafb;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#09090b;margin:0;padding:32px 16px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#111113;border:1px solid #27272a;border-radius:18px;overflow:hidden;">
                    <tr>
                      <td style="padding:28px 28px 18px 28px;text-align:center;background:#18181b;">
                        <div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:14px;background:#431407;color:#fb923c;font-size:28px;font-weight:800;margin-bottom:14px;">
                          F
                        </div>
                        <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.25;font-weight:800;">
                          ${appName}
                        </h1>
                        <p style="margin:8px 0 0 0;color:#a1a1aa;font-size:14px;line-height:1.5;">
                          Recuperacion de acceso
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:30px 28px 8px 28px;">
                        <h2 style="margin:0 0 12px 0;color:#ffffff;font-size:20px;line-height:1.3;font-weight:700;">
                          Cambia tu contrasena
                        </h2>
                        <p style="margin:0 0 18px 0;color:#d4d4d8;font-size:15px;line-height:1.6;">
                          Recibimos una solicitud para restablecer la contrasena de tu cuenta.
                          Para continuar, pulsa el siguiente boton y crea una nueva contrasena segura.
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="padding:8px 28px 28px 28px;">
                        <a href="${input.resetUrl}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:13px 22px;border-radius:10px;">
                          Cambiar contrasena
                        </a>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:0 28px 24px 28px;">
                        <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:14px 16px;">
                          <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.6;">
                            Este enlace caduca pronto y solo puede usarse una vez.
                            Si no solicitaste este cambio, puedes ignorar este correo.
                          </p>
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:0 28px 30px 28px;">
                        <p style="margin:0 0 8px 0;color:#71717a;font-size:12px;line-height:1.5;">
                          Si el boton no funciona, copia y pega este enlace en tu navegador:
                        </p>
                        <p style="margin:0;color:#fb923c;font-size:12px;line-height:1.5;word-break:break-all;">
                          ${input.resetUrl}
                        </p>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:18px 0 0 0;color:#71717a;font-size:12px;line-height:1.5;">
                    Mensaje automatico de ${appName}. Por favor no respondas a este correo.
                  </p>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });
  }

  private getTransporter() {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') || '587');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const secure = this.config.get<string>('SMTP_SECURE') === 'true' || port === 465;

    if (!host || !user || !pass) {
      this.logger.error('SMTP configuration is incomplete. Required: SMTP_HOST, SMTP_USER, SMTP_PASS');
      throw new Error('SMTP configuration is incomplete');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    return this.transporter;
  }
}
