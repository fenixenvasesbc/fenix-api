import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClichesService } from './cliches.service';
import { ClicheProductionService } from './cliche-production.service';
import {
  ClicheIdParamDto,
  CreateClicheDto,
  ListClichesQueryDto,
  UpdateClicheDto,
} from './dto/cliche.dto';

@Controller('cliches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.FACTORY)
export class ClichesController {
  constructor(
    private readonly cliches: ClichesService,
    private readonly production: ClicheProductionService,
  ) {}

  @Post()
  create(@Body() dto: CreateClicheDto) {
    return this.cliches.create(dto);
  }

  @Post('production-plan')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  importProductionPlan(@UploadedFile() file?: Express.Multer.File) {
    return this.production.importPdf(file);
  }

  @Get('categories')
  getCategories() {
    return this.cliches.getCategories();
  }

  @Get()
  findAll(@Query() query: ListClichesQueryDto) {
    return this.cliches.findAll(query);
  }

  @Get(':id')
  findOne(@Param() params: ClicheIdParamDto) {
    return this.cliches.findOne(params.id);
  }

  @Patch(':id')
  update(@Param() params: ClicheIdParamDto, @Body() dto: UpdateClicheDto) {
    return this.cliches.update(params.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param() params: ClicheIdParamDto) {
    return this.cliches.remove(params.id);
  }
}
