import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SYSTEM_LABEL_CODES } from 'src/common/constants/lead-labels';
import { LeadsService } from '../leads/leads.service';
import { DesignRequestSlaSchedulerService } from './design-request-sla-scheduler.service';

describe('DesignRequestSlaSchedulerService', () => {
  let service: DesignRequestSlaSchedulerService;
  let prisma: {
    designRequest: { findMany: jest.Mock; update: jest.Mock };
  };
  let leadsService: { setLabel: jest.Mock };

  beforeEach(async () => {
    prisma = {
      designRequest: { findMany: jest.fn(), update: jest.fn() },
    };
    leadsService = { setLabel: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DesignRequestSlaSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: LeadsService, useValue: leadsService },
      ],
    }).compile();

    service = module.get<DesignRequestSlaSchedulerService>(
      DesignRequestSlaSchedulerService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does nothing when there are no overdue requests', async () => {
    prisma.designRequest.findMany.mockResolvedValue([]);

    await service.run();

    expect(leadsService.setLabel).not.toHaveBeenCalled();
    expect(prisma.designRequest.update).not.toHaveBeenCalled();
  });

  it('only queries requests overdue, not completed/approved and not already flagged', async () => {
    prisma.designRequest.findMany.mockResolvedValue([]);

    await service.run();

    expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dueAt: { lt: expect.any(Date) },
          completedAt: null,
          approvedAt: null,
          overdueLabelAppliedAt: null,
        },
      }),
    );
  });

  it('applies BOCETOS_ATRASADOS to each overdue request and stamps overdueLabelAppliedAt', async () => {
    prisma.designRequest.findMany.mockResolvedValue([
      { id: 'req-1', accountId: 'account-1', leadId: 'lead-1' },
      { id: 'req-2', accountId: 'account-2', leadId: 'lead-2' },
    ]);

    await service.run();

    expect(leadsService.setLabel).toHaveBeenCalledWith({
      accountId: 'account-1',
      leadId: 'lead-1',
      label: SYSTEM_LABEL_CODES.BOCETOS_ATRASADOS,
    });
    expect(leadsService.setLabel).toHaveBeenCalledWith({
      accountId: 'account-2',
      leadId: 'lead-2',
      label: SYSTEM_LABEL_CODES.BOCETOS_ATRASADOS,
    });
    expect(prisma.designRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { overdueLabelAppliedAt: expect.any(Date) },
    });
    expect(prisma.designRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-2' },
      data: { overdueLabelAppliedAt: expect.any(Date) },
    });
  });

  it('keeps processing remaining requests when one fails', async () => {
    prisma.designRequest.findMany.mockResolvedValue([
      { id: 'req-1', accountId: 'account-1', leadId: 'lead-1' },
      { id: 'req-2', accountId: 'account-2', leadId: 'lead-2' },
    ]);
    leadsService.setLabel
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});

    await service.run();

    expect(prisma.designRequest.update).toHaveBeenCalledTimes(1);
    expect(prisma.designRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-2' },
      data: { overdueLabelAppliedAt: expect.any(Date) },
    });
  });
});
