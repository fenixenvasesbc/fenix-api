import {
  IsString,
  IsNotEmpty,
  Matches,
  IsUUID,
  IsOptional,
  IsEmail,
  MinLength,
  IsBoolean,
  IsBooleanString,
} from 'class-validator';

/**
 * ============================
 * CREATE ACCOUNT
 * ============================
 */
export class AccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  wabaId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\+\d+$/, {
    message: 'phoneE164 must be in E.164 format (+123456789)',
  })
  phoneE164: string;

  @IsUUID()
  @IsNotEmpty()
  assignToUserId: string;
}

/**
 * ============================
 * UPDATE ACCOUNT + USER
 * ============================
 */
export class UpdateAccountWithUserDto {
  // Account fields
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+\d+$/, {
    message: 'phoneE164 must be in E.164 format (+123456789)',
  })
  phoneE164?: string;

  // User fields
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * ============================
 * PARAM: ACCOUNT ID
 * ============================
 */
export class AccountIdParamDto {
  @IsUUID()
  id: string;
}

/**
 * ============================
 * QUERY: FILTER ACCOUNTS
 * ============================
 */
export class FindAccountsQueryDto {
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

/**
 * ============================
 * RESPONSE DTOs
 * ============================
 */

export class AccountUserResponseDto {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class LeadResponseDto {
  id: string;
  name: string | null;
  phoneE164: string;
  email: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  lastMessageAt?: Date | null;
}

export class AccountResponseDto {
  id: string;
  name: string;
  wabaId: string;
  phoneE164: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AccountWithUserResponseDto {
  id: string;
  name: string;
  wabaId: string;
  phoneE164: string;
  createdAt: Date;
  updatedAt: Date;
  user: AccountUserResponseDto | null;
}

export class AccountWithLeadsResponseDto {
  id: string;
  name: string;
  wabaId: string;
  phoneE164: string;
  createdAt: Date;
  updatedAt: Date;
  user: AccountUserResponseDto | null;
  leads: LeadResponseDto[];
}

export class MyAccountProfileResponseDto {
  user: AccountUserResponseDto;
  account: AccountResponseDto | null;
}

export class MyLeadsResponseDto {
  accountId: string;
  leads: LeadResponseDto[];
}
