import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { RefreshTokensModule } from './modules/refresh-tokens/refresh-tokens.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { EventsController } from './modules/events/events.controller';
import { EventsService } from './modules/events/events.service';
import { EventsModule } from './modules/events/events.module';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),UsersModule, AuthModule, PrismaModule, RefreshTokensModule, AccountsModule, EventsModule, DashboardModule],
  controllers: [AppController, EventsController, DashboardController],
  providers: [AppService, EventsService, DashboardService],
})
export class AppModule {}
