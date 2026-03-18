import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CredentialCryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!secret) {
      throw new InternalServerErrorException(
        'CREDENTIAL_ENCRYPTION_KEY is not configured',
      );
    }

    // Deriva una key fija de 32 bytes desde el secret
    this.key = crypto.createHash('sha256').update(secret).digest();
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  }

  decrypt(cipherText: string): string {
    const [ivB64, authTagB64, encryptedB64] = cipherText.split('.');

    if (!ivB64 || !authTagB64 || !encryptedB64) {
      throw new InternalServerErrorException(
        'Invalid encrypted credential format',
      );
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  buildHint(secret: string): string {
    const last4 = secret.slice(-4);
    return `***${last4}`;
  }
}
