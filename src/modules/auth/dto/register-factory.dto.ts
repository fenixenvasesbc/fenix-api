import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterFactoryDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
