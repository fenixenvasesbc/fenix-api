import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsBooleanString,
  IsNotEmpty,
  Matches,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsEnum(Role)
  role: Role;

  // ==========================================
  // Cuenta de YCloud asociada (solo aplica y es
  // obligatorio cuando role === SALES). Se crea el
  // Account + AccountProviderCredential en la misma
  // transaccion que el User.
  // ==========================================

  @ValidateIf((dto: CreateUserDto) => dto.role === Role.SALES)
  @IsString()
  @IsNotEmpty()
  accountName?: string;

  @ValidateIf((dto: CreateUserDto) => dto.role === Role.SALES)
  @IsString()
  @IsNotEmpty()
  wabaId?: string;

  @ValidateIf((dto: CreateUserDto) => dto.role === Role.SALES)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+\d+$/, {
    message: 'phoneE164 must be in E.164 format (+123456789)',
  })
  phoneE164?: string;

  @ValidateIf((dto: CreateUserDto) => dto.role === Role.SALES)
  @IsString()
  @IsNotEmpty()
  apiKey?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
