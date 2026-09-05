import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GlobalTemplatesService } from './global-templates.service';
import {
  AddGlobalTemplateAccountDto,
  CreateGlobalTemplateDto,
} from './dto/global-template.dto';

// Meta acepta JPEG/PNG (y en la practica WEBP) como muestra de header IMAGE
// para revision de plantillas; 5MB es el limite recomendado por WhatsApp
// para medios de plantilla.
const ALLOWED_TEMPLATE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const TEMPLATE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TEMPLATE_IMAGE_CLOUDINARY_FOLDER = 'Imagenes Plantillas';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

// Gestion global de plantillas de WhatsApp: se crea una vez y se replica
// automaticamente en el WABA de cada comercial (Account) activo. Solo
// ADMIN y SALES_MANAGER pueden gestionarlas.
@Controller('templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SALES_MANAGER)
export class GlobalTemplatesController {
  constructor(
    private readonly globalTemplatesService: GlobalTemplatesService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // Sube la imagen de muestra del header de una plantilla a Cloudinary y
  // devuelve su URL publica, para que el formulario de creacion de
  // plantillas la use directamente como headerMediaUrl (en vez de pedirle
  // al usuario que pegue una URL a mano). No crea ni modifica ninguna
  // plantilla; es solo el paso de subida de imagen.
  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: TEMPLATE_IMAGE_MAX_BYTES },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No se recibio ningun archivo');
    }

    if (!ALLOWED_TEMPLATE_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Formato de imagen no soportado (usa JPEG, PNG o WEBP)',
      );
    }

    const uploaded = await this.cloudinaryService.uploadImage({
      buffer: file.buffer,
      folder: TEMPLATE_IMAGE_CLOUDINARY_FOLDER,
      filename: file.originalname,
    });

    return { url: uploaded.url };
  }

  @Post()
  create(@Body() dto: CreateGlobalTemplateDto, @Req() req: { user: AuthUser }) {
    return this.globalTemplatesService.create(req.user.userId, dto);
  }

  @Get()
  list() {
    return this.globalTemplatesService.list();
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.globalTemplatesService.getById(id);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.globalTemplatesService.remove(id);
  }

  @Post(':id/accounts')
  addAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddGlobalTemplateAccountDto,
  ) {
    return this.globalTemplatesService.addAccount(id, dto.accountId);
  }

  @Delete(':id/accounts/:accountTemplateId')
  removeAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('accountTemplateId', new ParseUUIDPipe()) accountTemplateId: string,
  ) {
    return this.globalTemplatesService.removeAccount(id, accountTemplateId);
  }
}
