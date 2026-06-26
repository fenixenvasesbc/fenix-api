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
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClichesService } from './cliches.service';
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
  constructor(private readonly cliches: ClichesService) {}

  @Post()
  create(@Body() dto: CreateClicheDto) {
    return this.cliches.create(dto);
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
