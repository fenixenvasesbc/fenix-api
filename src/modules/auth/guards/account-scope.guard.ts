import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

@Injectable()
export class AccountScope implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<any>();
    const user = req.user as { role: Role; accountId?: string | null } | undefined;

    const accountIdParam = req.params?.accountId as string | undefined;
    if (!accountIdParam) return true; // si la ruta no es por cuenta, no aplica

    if (!user?.role) throw new ForbiddenException('Missing user');

    // Admin puede ver cualquier cuenta (si esa es tu política).
    // SUPPORT ve todo lo que ve ADMIN (herencia de roles en el backend).
    if (user.role === Role.ADMIN || user.role === Role.SUPPORT) return true;

    // Sales solo su cuenta
    const userAccountId = user.accountId ?? null;
    if (!userAccountId) throw new ForbiddenException('Sales has no account assigned');
    if (userAccountId !== accountIdParam) throw new ForbiddenException('Forbidden for this account');

    return true;
  }
}