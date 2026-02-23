import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const apiKey = req.headers['x-api-key'] as string | undefined;

    const expected = this.config.get<string>('N8N_API_KEY');
    if (!expected) {
      throw new UnauthorizedException('Server misconfigured: missing N8N_API_KEY');
    }
    if (!apiKey || apiKey !== expected) {
      throw new UnauthorizedException('Invalid X-API-Key');
    }
    return true;
  }
}