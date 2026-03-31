import * as crypto from 'crypto';

type Input = {
  accountId: string;
  apiKey: string;
};

const algorithm = 'aes-256-gcm';
const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || 'dsaqrfagdfasfgsdf';

if (!secret) {
  throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
}

const key = crypto.createHash('sha256').update(secret).digest();

function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

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

const data: Input[] = [
  { accountId: 'a77dd46b-a1e3-4d9c-bfd6-5c42216687f9', apiKey: '1265580496bd60a0e5939286c59bae5d' },
  { accountId: 'cc247590-6902-4757-b905-4feb90f4ea91', apiKey: 'b3abd988a32d976423ab3aef967fc13f' },
  { accountId: '15169945-cba4-4650-a0cd-82361231705e', apiKey: '2088af0c7d5237767e051696e3177757' },
  { accountId: 'eaf58269-79e7-4e99-a57d-a7577e79bddf', apiKey: '566eef6fdab14f328088163fb54d4548' },
  { accountId: 'e8815bc6-15a9-4bb2-a792-11f480977458', apiKey: 'db5f80d8cb707ee9649a5ffd0944963c' },
  { accountId: '26b0a335-2aa4-45c4-a5c8-35a63fdc052e', apiKey: 'f1bde64ce631c4173c68a110dda08e20' },
  { accountId: '976ef9a3-94c2-4ac6-bbc0-436aa56ff218', apiKey: '947d99c4aaa4ce4a47be51bcc957c18c' },
];

const results = data.map((item) => ({
  accountId: item.accountId,
  encryptedApiKey: encrypt(item.apiKey),
}));

console.log('='.repeat(80));
console.log('ENCRYPTED ACCOUNT KEYS');
console.log('='.repeat(80));
console.log(JSON.stringify(results, null, 2));

console.log('\n--- SQL UPDATE READY ---\n');

for (const r of results) {
  console.log(
`UPDATE account_provider_credential
SET "apiKeyEncrypted" = '${r.encryptedApiKey}',
    "isActive" = true
WHERE "accountId" = '${r.accountId}'
  AND "provider" = 'YCLOUD';\n`
  );
}