import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { DesignBoardService } from '../design-board/design-board.service';

const SALES = { userId: 'sales-1', role: Role.SALES, accountId: 'account-1' };

describe('LeadsController', () => {
  let controller: LeadsController;
  let leadsService: { setLabel: jest.Mock };
  let designBoardService: { approveByLabel: jest.Mock };
  let moduleRef: { get: jest.Mock };

  beforeEach(async () => {
    leadsService = { setLabel: jest.fn().mockResolvedValue({ id: 'lead-1' }) };
    designBoardService = { approveByLabel: jest.fn().mockResolvedValue({}) };
    moduleRef = { get: jest.fn().mockReturnValue(designBoardService) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [
        { provide: LeadsService, useValue: leadsService },
        { provide: ModuleRef, useValue: moduleRef },
      ],
    }).compile();

    controller = module.get<LeadsController>(LeadsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('setLabel', () => {
    it('applies an ordinary label without touching DesignBoardService', async () => {
      const req = { user: SALES };

      await controller.setLabel('lead-1', undefined, { label: 'PRODUCCION' }, req);

      expect(designBoardService.approveByLabel).not.toHaveBeenCalled();
      expect(leadsService.setLabel).toHaveBeenCalledWith({
        accountId: 'account-1',
        leadId: 'lead-1',
        label: 'PRODUCCION',
        reminderDays: undefined,
        changedByUserId: 'sales-1',
      });
    });

    it('calls DesignBoardService.approveByLabel BEFORE applying BOCETO_APROBADO', async () => {
      const req = { user: SALES };
      const callOrder: string[] = [];
      designBoardService.approveByLabel.mockImplementation(async () => {
        callOrder.push('approveByLabel');
      });
      leadsService.setLabel.mockImplementation(async () => {
        callOrder.push('setLabel');
        return { id: 'lead-1' };
      });

      await controller.setLabel(
        'lead-1',
        undefined,
        { label: 'BOCETO_APROBADO' },
        req,
      );

      expect(designBoardService.approveByLabel).toHaveBeenCalledWith(
        'account-1',
        'lead-1',
        'sales-1',
      );
      expect(callOrder).toEqual(['approveByLabel', 'setLabel']);
      expect(moduleRef.get).toHaveBeenCalledWith(DesignBoardService, {
        strict: false,
      });
    });

    it('blocks the label: setLabel is never called when approveByLabel throws', async () => {
      const req = { user: SALES };
      designBoardService.approveByLabel.mockRejectedValue(
        new BadRequestException('no pending request'),
      );

      await expect(
        controller.setLabel('lead-1', undefined, { label: 'BOCETO_APROBADO' }, req),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(leadsService.setLabel).not.toHaveBeenCalled();
    });
  });
});
