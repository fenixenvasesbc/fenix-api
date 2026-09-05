import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Readable } from 'stream';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

// Credenciales de Cloudinary por variables de entorno (el usuario las
// configura en produccion, no viven en el repo):
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  private ensureConfigured() {
    if (this.configured) return;

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Cloudinary no esta configurado: faltan las variables de entorno ' +
          'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y/o CLOUDINARY_API_SECRET',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    this.configured = true;
  }

  // Sube un buffer de imagen a Cloudinary y devuelve la URL publica
  // (secure_url) para usar como headerMediaUrl de una plantilla de
  // WhatsApp. Meta/YCloud ya acepta cualquier URL publica en ese campo
  // (ver YcloudService.buildMediaReference), asi que no hace falta nada
  // mas para que la plantilla quede lista para revision.
  async uploadImage(input: {
    buffer: Buffer;
    folder?: string;
    filename?: string;
  }): Promise<{ url: string; publicId: string }> {
    this.ensureConfigured();

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: input.folder,
          resource_type: 'image',
          filename_override: input.filename,
          use_filename: Boolean(input.filename),
          unique_filename: true,
          overwrite: false,
        },
        (error: unknown, result?: UploadApiResponse) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            reject(
              new InternalServerErrorException(
                'No se pudo subir la imagen a Cloudinary',
              ),
            );
            return;
          }

          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );

      Readable.from(input.buffer).pipe(uploadStream);
    });
  }
}
