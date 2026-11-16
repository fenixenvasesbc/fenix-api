import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

const SALES = { userId: 'sales-1', role: Role.SALES, accountId: 'account-1' };

describe('LeadsController', () => {
  let controller: LeadsController;
  let leadsService: { setLabel: jest.Mock };

  beforeEach(async () => {
    leadsService = { setLabel: jest.fn().mockResolvedValue({ id: 'lead-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [{ provide: LeadsService, useValue: leadsService }],
    }).compile();

    controller = module.get<LeadsController>(LeadsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('setLabel', () => {
    it('applies an ordinary label normally', async () => {
      const req = { user: SALES };

      await controller.setLabel('lead-1', undefined, { label: 'PRODUCCION' }, req);

      expect(leadsService.setLabel).toHaveBeenCalledWith({
        accountId: 'account-1',
        leadId: 'lead-1',
        label: 'PRODUCCION',
        reminderDays: undefined,
        changedByUserId: 'sales-1',
      });
    });

    // 16/nov/2026, pedido explicito del usuario: ya no se puede aprobar un
    // boceto poniendo la etiqueta BOCETO_APROBADO a mano desde el chat --
    // ese camino (ADR-004 Submódulo 2) fue eliminado. La única forma de
    // aprobar es desde el tablero (DesignBoardService.approve()).
    it('blocks BOCETO_APROBADO unconditionally, without ever calling setLabel', async () => {
      const req = { user: SALES };

      await expect(
        controller.setLabel('lead-1', undefined, { label: 'BOCETO_APROBADO' }, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(leadsService.setLabel).not.toHaveBeenCalled();
    });
  });
});
