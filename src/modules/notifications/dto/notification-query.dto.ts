import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AppNotificationStatus } from '@prisma/client';

export const NOTIFICATION_STATUS_FILTERS = [
  AppNotificationStatus.UNREAD,
  AppNotificationStatus.READ,
  'ALL',
] as const;

export type NotificationStatusFilter =
  (typeof NOTIFICATION_STATUS_FILTERS)[number];

export class NotificationsQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUS_FILTERS)
  status?: NotificationStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class NotificationAccountQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
