import * as crypto from 'crypto';

type AuditStatus =
  | 'OK_DECRYPTED'
  | 'INVALID_FORMAT'
  | 'EMPTY'
  | 'DECRYPT_FAILED';

type AuditResult = {
  index: number;
  rawPreview: string;
  detectedFormat: 'AES_GCM_DOT' | 'PBKDF2_HASH' | 'UNKNOWN' | 'EMPTY';
  status: AuditStatus;
  reason: string;
  decryptedPreview?: string;
};

class CredentialCryptoServiceLike {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
    }
    this.key = crypto.createHash('sha256').update(secret).digest();
  }

  decrypt(cipherText: string): string {
    const [ivB64, authTagB64, encryptedB64] = cipherText.split('.');

    if (!ivB64 || !authTagB64 || !encryptedB64) {
      throw new Error('Invalid encrypted credential format');
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
}

const CREDENTIAL_ENCRYPTION_KEY =
  process.env.CREDENTIAL_ENCRYPTION_KEY || 'dsaqrfagdfasfgsdf';

// Pega aquí tus valores reales a auditar
const values: string[] = [
  '23NkB+Ph0ipwvA6K.9ZHmVCuOK9kRVrTSxbmIzw==.4akUOvzTTayI0I2UBuN1QFGm6e6pYFa/kVOVdCFdePs=',
  '8DEoU0BrZmmdt+70.kdDC1qrvTkF2el8Vksfn8Q==.qpgEN7ea079AUonR89nExdiH8wlfTT7lpFTSijGKgKg=',
  'd42jaRwYfW/886IZ.mW3DusPVDAVdPeTejR8WfQ==.dR/QCdEg2qnFzH6EnJXY+T9MIlgNspfgCZIZ+1WXoLA=',
  'q8u7lbuypKQubLCj.QqQFJkH5X8T11ui0lFwjiw==.fnHR4MIX/Ikz+ambg/FfT8zJETmS6OLjnYcj+Y3aWv4=',
  '2ZdgS+IwayJRpExX.YvB6MW6f9vGSfYw0f2LVSA==.3vKUgBEmZh3og82QoU7yjuVkh7GDbTOKnAW63/60D80=',
  'XvsRI7kmfEZqqnp/.Ldy0u/k5nQkK2ZeCLj7OFw==.uiRWIUZpoHViNiHop3ojuERM82ny/1BZUsRO15jvYDY=',
  'iZpt0agBWxZ7VWO5.DPFmbjVNs2pCz1BsLJ/lvQ==.2mTZ9PhzL9OBVhaoYLTrIszHpgKlHmALZEnyyu0wVeE=',
];

function preview(value: string, max = 28): string {
  if (!value) return '(empty)';
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function detectFormat(value: string): AuditResult['detectedFormat'] {
  if (!value || !value.trim()) return 'EMPTY';
  if (value.startsWith('$pbkdf2-sha256$')) return 'PBKDF2_HASH';

  const parts = value.split('.');
  if (parts.length === 3 && parts.every(Boolean)) return 'AES_GCM_DOT';

  return 'UNKNOWN';
}

function auditValue(
  svc: CredentialCryptoServiceLike,
  value: string,
  index: number,
): AuditResult {
  const detectedFormat = detectFormat(value);

  if (!value || !value.trim()) {
    return {
      index,
      rawPreview: '(empty)',
      detectedFormat,
      status: 'EMPTY',
      reason: 'Valor vacío o nulo',
    };
  }

  if (detectedFormat === 'PBKDF2_HASH') {
    return {
      index,
      rawPreview: preview(value),
      detectedFormat,
      status: 'INVALID_FORMAT',
      reason:
        'Es un hash PBKDF2; tu servicio espera ciphertext AES-256-GCM con formato iv.authTag.encrypted',
    };
  }

  if (detectedFormat !== 'AES_GCM_DOT') {
    return {
      index,
      rawPreview: preview(value),
      detectedFormat,
      status: 'INVALID_FORMAT',
      reason:
        'No coincide con el formato esperado por decrypt(): 3 segmentos base64 separados por punto',
    };
  }

  try {
    const plain = svc.decrypt(value);

    return {
      index,
      rawPreview: preview(value),
      detectedFormat,
      status: 'OK_DECRYPTED',
      reason: 'Desencriptado correctamente',
      decryptedPreview: preview(plain, 20),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown decrypt error';

    return {
      index,
      rawPreview: preview(value),
      detectedFormat,
      status: 'DECRYPT_FAILED',
      reason: message,
    };
  }
}

function printReport(results: AuditResult[]) {
  console.log('='.repeat(90));
  console.log('CREDENTIAL AUDIT REPORT');
  console.log('='.repeat(90));

  for (const r of results) {
    console.log(`\n[${r.index}] ${r.rawPreview}`);
    console.log(`  format : ${r.detectedFormat}`);
    console.log(`  status : ${r.status}`);
    console.log(`  reason : ${r.reason}`);
    if (r.decryptedPreview) {
      console.log(`  plain  : ${r.decryptedPreview}`);
    }
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log('\n' + '-'.repeat(90));
  console.log('SUMMARY');
  console.log('-'.repeat(90));
  console.log(`Total           : ${results.length}`);
  console.log(`OK_DECRYPTED    : ${summary.OK_DECRYPTED || 0}`);
  console.log(`INVALID_FORMAT  : ${summary.INVALID_FORMAT || 0}`);
  console.log(`DECRYPT_FAILED  : ${summary.DECRYPT_FAILED || 0}`);
  console.log(`EMPTY           : ${summary.EMPTY || 0}`);
  console.log('-'.repeat(90));
}

function main() {
  const svc = new CredentialCryptoServiceLike(CREDENTIAL_ENCRYPTION_KEY);
  const results = values.map((value, i) => auditValue(svc, value, i + 1));
  printReport(results);
}

main();
