import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { RefreshTokensModule } from './modules/refresh-tokens/refresh-tokens.module';
import { AccountsModule } from './modules/accounts/accounts.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),UsersModule, AuthModule, PrismaModule, RefreshTokensModule, AccountsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
