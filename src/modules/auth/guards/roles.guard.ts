import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

// SALES_MANAGER es un SALES normal con permisos extra (gestion de conocimiento
// del asistente, igual que ADMIN). En vez de agregar Role.SALES_MANAGER a cada
// @Roles(Role.SALES) suelto por el codigo (leads, conversaciones, mensajes,
// notificaciones, etc.), esta tabla declara la herencia en un solo lugar: si
// una ruta le exige SALES, un SALES_MANAGER tambien pasa. Los permisos
// exclusivos (como el modulo de conocimiento) se siguen listando explicitos
// en cada @Roles(...) porque no son "todo lo que puede ADMIN", solo esa parte.
const ROLE_INHERITANCE: Partial<Record<Role, Role[]>> = {
  [Role.SALES_MANAGER]: [Role.SALES],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<any>();
    const user = req.user as { userId: string; role: Role; accountId?: string | null } | undefined;

    if (!user?.role) throw new ForbiddenException('Missing role');

    const effectiveRoles = [user.role, ...(ROLE_INHERITANCE[user.role] ?? [])];
    if (!required.some((role) => effectiveRoles.includes(role))) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
