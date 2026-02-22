// create-account.dto.ts
import { IsString, IsNotEmpty, Matches, IsUUID } from 'class-validator';

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
  assignToUserId: string;
}