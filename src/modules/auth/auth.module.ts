import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { RefreshTokensModule } from '../refresh-tokens/refresh-tokens.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PasswordResetMailService } from './password-reset-mail.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    UsersModule,
    RefreshTokensModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET');
        if (!secret) throw new Error('JWT_ACCESS_SECRET is missing');

        // 900s = 15 minutos (en segundos)
        const expiresIn = Number(config.get<string>('JWT_ACCESS_TTL_SECONDS') ?? '900');

        return {
          secret,
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard, PasswordResetMailService],
})
export class AuthModule {}
