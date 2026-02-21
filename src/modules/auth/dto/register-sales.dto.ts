import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterSalesDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}