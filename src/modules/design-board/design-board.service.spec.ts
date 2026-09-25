import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppNotificationType, DesignAttachmentKind, DesignRequestCountry, Role } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { OutboundService } from '../outbound/outbound.service';
import { BusinessDaysService } from 'src/common/business-days/business-days.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { SYSTEM_LABEL_CODES } from 'src/common/constants/lead-labels';
import { DesignBoardService, AuthUser } from './design-board.service';

const SALES: AuthUser = { userId: 'sales-1', role: Role.SALES, accountId: 'account-1' };
const OTHER_SALES: AuthUser = { userId: 'sales-2', role: Role.SALES, accountId: 'account-2' };
const ADMIN: AuthUser = { userId: 'admin-1', role: Role.ADMIN, accountId: null };
const DESIGNER: AuthUser = { userId: 'designer-1', role: Role.DESIGNER, accountId: null };
const OTHER_DESIGNER: AuthUser = { userId: 'designer-2', role: Role.DESIGNER, accountId: null };
const MANAGER: AuthUser = { userId: 'manager-1', role: Role.DESIGNER_MANAGER, accountId: null };

const COLUMNS = [
  { id: 'col-new', boardId: 'board-1', code: 'NEW', name: 'Bocetos nuevos', sortOrder: 0, isInitial: true, isModification: false, isFinal: false, isApproved: false, modificationSlaBusinessDays: null },
  { id: 'col-review', boardId: 'board-1', code: 'IN_REVIEW', name: 'Boceto en revisión', sortOrder: 1, isInitial: false, isModification: false, isFinal: false, isApproved: false, modificationSlaBusinessDays: null },
  { id: 'col-done', boardId: 'board-1', code: 'DONE', name: 'Boceto terminado', sortOrder: 2, isInitial: false, isModification: false, isFinal: true, isApproved: false, modificationSlaBusinessDays: null },
  { id: 'col-approved', boardId: 'board-1', code: 'APPROVED', name: 'Aprobados', sortOrder: 3, isInitial: false, isModification: false, isFinal: false, isApproved: true, modificationSlaBusinessDays: null },
  // ADR-004 Submódulo 4: sortOrder 0.5 la coloca, al reordenar, entre "NEW"
  // (0) y "IN_REVIEW" (1) -- solo relevante para los tests que resuelven
  // el orden real vía move()/sendToModification(); los índices COLUMNS[0..3]
  // de arriba se mantienen intactos para no tocar el resto de este archivo.
  { id: 'col-modification', boardId: 'board-1', code: 'MODIFICATION', name: 'Modificación', sortOrder: 0.5, isInitial: false, isModification: true, isFinal: false, isApproved: false, modificationSlaBusinessDays: 1 },
];

function board() {
  return { id: 'board-1', name: 'Bocetos', defaultSlaDays: 3, slaCutoffHour: 14, active: true, columns: COLUMNS };
}

describe('DesignBoardService', () => {
  let service: DesignBoardService;
  let prisma: {
    designBoard: { findFirst: jest.Mock; findFirstOrThrow: jest.Mock; create: jest.Mock };
    designBoardColumn: { createMany: jest.Mock };
    designRequest: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    designRequestStatusEvent: { create: jest.Mock };
    designRequestComment: { create: jest.Mock };
    designRequestAttachment: { findFirst: jest.Mock; update: jest.Mock };
    appNotification: { upsert: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock };
    lead: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let leadsService: { setLabel: jest.Mock };
  let outboundService: { sendMediaMessage: jest.Mock };
  let businessDaysService: {
    loadHolidaySet: jest.Mock;
    computeBusinessDueAt: jest.Mock;
    businessDaysUntilDue: jest.Mock;
  };
  let chatEvents: { publish: jest.Mock };
  let tx: {
    designRequest: { create: jest.Mock; update: jest.Mock };
    designRequestStatusEvent: { create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      designRequest: { create: jest.fn(), update: jest.fn() },
      designRequestStatusEvent: { create: jest.fn() },
    };

    prisma = {
      designBoard: {
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        create: jest.fn(),
      },
      designBoardColumn: { createMany: jest.fn() },
      designRequest: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      designRequestStatusEvent: { create: jest.fn() },
      designRequestComment: { create: jest.fn() },
      designRequestAttachment: { findFirst: jest.fn(), update: jest.fn() },
      appNotification: { upsert: jest.fn(), create: jest.fn() },
      user: { findUnique: jest.fn() },
      lead: { findUnique: jest.fn() },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    leadsService = { setLabel: jest.fn().mockResolvedValue({}) };
    outboundService = { sendMediaMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    businessDaysService = {
      loadHolidaySet: jest.fn().mockResolvedValue(new Set<string>()),
      computeBusinessDueAt: jest
        .fn()
        .mockReturnValue(new Date('2026-10-01T13:00:00.000Z')),
      businessDaysUntilDue: jest.fn().mockReturnValue(2),
    };
    chatEvents = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DesignBoardService,
        { provide: PrismaService, useValue: prisma },
        { provide: LeadsService, useValue: leadsService },
        { provide: OutboundService, useValue: outboundService },
        { provide: BusinessDaysService, useValue: businessDaysService },
        { provide: ChatEventsService, useValue: chatEvents },
      ],
    }).compile();

    service = module.get<DesignBoardService>(DesignBoardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // getOrCreateDefaultBoard
  // ---------------------------------------------------------------

  describe('getOrCreateDefaultBoard', () => {
    it('returns the existing board when it already has columns', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(board());

      const result = await service.getOrCreateDefaultBoard();

      expect(result).toEqual(board());
      expect(prisma.designBoard.create).not.toHaveBeenCalled();
    });

    it('creates a board with the 4 default columns when none exists', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(null);
      prisma.designBoard.create.mockResolvedValue(board());

      const result = await service.getOrCreateDefaultBoard();

      expect(prisma.designBoard.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(board());
    });

    it('fills in the columns of a board that exists without any', async () => {
      const emptyBoard = { ...board(), columns: [] };
      prisma.designBoard.findFirst.mockResolvedValue(emptyBoard);
      prisma.designBoardColumn.createMany.mockResolvedValue({ count: 4 });
      prisma.designBoard.findFirstOrThrow.mockResolvedValue(board());

      const result = await service.getOrCreateDefaultBoard();

      expect(prisma.designBoardColumn.createMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual(board());
    });
  });

  // ---------------------------------------------------------------
  // createRequest
  // ---------------------------------------------------------------

  describe('createRequest', () => {
    const dto = { leadId: 'lead-1', title: 'Boceto para cliente X' };

    it('rejects roles other than SALES/ADMIN', async () => {
      await expect(service.createRequest(DESIGNER, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFound if the lead does not exist', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);

      await expect(service.createRequest(SALES, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden if a SALES user tries to create a request for a lead of another account', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', accountId: 'account-2' });

      await expect(service.createRequest(SALES, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('creates the request in the initial column, with attachments, and applies BOCETO_EN_PROCESO', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', accountId: 'account-1' });
      prisma.designBoard.findFirst.mockResolvedValue(board());
      tx.designRequest.create.mockResolvedValue({
        id: 'req-1',
        columnId: 'col-new',
        attachments: [{ id: 'att-1' }],
      });

      const result = await service.createRequest(SALES, {
        ...dto,
        country: DesignRequestCountry.FR,
        attachments: [
          { kind: DesignAttachmentKind.FROM_CHAT, sourceMessageId: 'msg-1' },
        ],
      });

      expect(businessDaysService.computeBusinessDueAt).toHaveBeenCalledWith(
        expect.any(Date),
        3,
        expect.any(Set),
        { cutoffHour: 14 },
      );
      expect(tx.designRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            boardId: 'board-1',
            columnId: 'col-new',
            leadId: 'lead-1',
            accountId: 'account-1',
            createdByUserId: 'sales-1',
            country: DesignRequestCountry.FR,
            slaBusinessDays: 3,
            dueAt: new Date('2026-10-01T13:00:00.000Z'),
          }),
        }),
      );
      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            designRequestId: 'req-1',
            fromColumnId: null,
            toColumnId: 'col-new',
            direction: 'FORWARD',
          }),
        }),
      );
      expect(leadsService.setLabel).toHaveBeenCalledWith({
        accountId: 'account-1',
        leadId: 'lead-1',
        label: SYSTEM_LABEL_CODES.BOCETO_EN_PROCESO,
        changedByUserId: 'sales-1',
      });
      expect(result).toEqual({
        id: 'req-1',
        columnId: 'col-new',
        attachments: [{ id: 'att-1' }],
      });
      expect(chatEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'design_request.created',
          payload: expect.objectContaining({ designRequestId: 'req-1' }),
        }),
      );
    });

    it('lets ADMIN create a request for any account', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'lead-9', accountId: 'account-9' });
      prisma.designBoard.findFirst.mockResolvedValue(board());
      tx.designRequest.create.mockResolvedValue({ id: 'req-2' });

      await service.createRequest(ADMIN, dto);

      expect(tx.designRequest.create).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // listRequests / getRequestDetail (visibilidad por rol)
  // ---------------------------------------------------------------

  describe('listRequests', () => {
    it('scopes SALES to only their own requests within their account, excluding "Aprobados"', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(SALES, {});

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdByUserId: 'sales-1',
            accountId: 'account-1',
            column: { isApproved: false },
            archivedAt: null,
          },
        }),
      );
    });

    it('scopes DESIGNER to only their assigned requests, excluding "Aprobados"', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(DESIGNER, {});

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignedUserId: 'designer-1',
            column: { isApproved: false },
            archivedAt: null,
          },
        }),
      );
    });

    it('excludes archived requests by default for DESIGNER_MANAGER/ADMIN, and includes them with includeArchived', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, {});
      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { archivedAt: null } }),
      );

      await service.listRequests(MANAGER, { includeArchived: true });
      const call = prisma.designRequest.findMany.mock.calls[1][0];
      expect(call.where.archivedAt).toBeUndefined();
    });

    it('lets DESIGNER_MANAGER filter by comercial/diseñador without restriction', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(board());
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, {
        assignedUserId: 'designer-9',
        createdByUserId: 'sales-9',
        columnId: 'col-new',
      });

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignedUserId: 'designer-9',
            createdByUserId: 'sales-9',
            columnId: 'col-new',
            archivedAt: null,
          },
        }),
      );
    });

    it('applies the current-month filter by default on the "Terminado" column', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(board());
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, { columnId: 'col-done' });

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            columnId: 'col-done',
            completedAt: { gte: expect.any(Date), lt: expect.any(Date) },
          }),
        }),
      );
    });

    it('skips the month filter on "Terminado" when completedMonth is "all"', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(board());
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, {
        columnId: 'col-done',
        completedMonth: 'all',
      });

      const call = prisma.designRequest.findMany.mock.calls[0][0];
      expect(call.where.completedAt).toBeUndefined();
    });

    it('does not apply the month filter to a non-"Terminado" column', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(board());
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, { columnId: 'col-review' });

      const call = prisma.designRequest.findMany.mock.calls[0][0];
      expect(call.where.completedAt).toBeUndefined();
    });
  });

  describe('getRequestDetail', () => {
    it('returns the request when visible, with the computed slaStatus attached', async () => {
      const request = {
        id: 'req-1',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
      };
      prisma.designRequest.findFirst.mockResolvedValue(request);

      const result = await service.getRequestDetail(SALES, 'req-1');

      expect(result).toEqual({ ...request, slaStatus: 'ON_TIME' });
    });

    it('throws NotFound when the request is not visible for this user', async () => {
      prisma.designRequest.findFirst.mockResolvedValue(null);

      await expect(service.getRequestDetail(OTHER_SALES, 'req-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------
  // assign
  // ---------------------------------------------------------------

  describe('assign', () => {
    it('rejects roles other than DESIGNER_MANAGER/ADMIN', async () => {
      await expect(
        service.assign(SALES, 'req-1', { assignedUserId: 'designer-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the target user is not a DESIGNER', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({ id: 'req-1', board: board(), column: COLUMNS[0] });
      prisma.user.findUnique.mockResolvedValue({ id: 'sales-1', role: Role.SALES });

      await expect(
        service.assign(MANAGER, 'req-1', { assignedUserId: 'sales-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assigns the designer', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({ id: 'req-1', board: board(), column: COLUMNS[0] });
      prisma.user.findUnique.mockResolvedValue({ id: 'designer-1', role: Role.DESIGNER });
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1', assignedUserId: 'designer-1' });

      const result = await service.assign(MANAGER, 'req-1', { assignedUserId: 'designer-1' });

      expect(prisma.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedUserId: 'designer-1',
            assignedByUserId: 'manager-1',
          }),
        }),
      );
      expect(result).toEqual({ id: 'req-1', assignedUserId: 'designer-1' });
    });
  });

  // ---------------------------------------------------------------
  // move
  // ---------------------------------------------------------------

  describe('move', () => {
    function inReviewRequest() {
      return {
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        assignedUserId: 'designer-1',
        column: COLUMNS[1],
        board: board(),
      };
    }

    it('forbids SALES from moving cards', async () => {
      await expect(
        service.move(SALES, 'req-1', { direction: 'FORWARD' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('hides the request from a DESIGNER who is not the assignee', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(inReviewRequest());

      await expect(
        service.move(OTHER_DESIGNER, 'req-1', { direction: 'FORWARD' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a move with no column in that direction', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...inReviewRequest(),
        column: COLUMNS[0],
      });

      await expect(
        service.move(MANAGER, 'req-1', { direction: 'BACKWARD' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects moving directly into the "Aprobados" column', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...inReviewRequest(),
        column: COLUMNS[2],
      });

      await expect(
        service.move(MANAGER, 'req-1', { direction: 'FORWARD' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('moves the card forward, and when it lands on the final column, sets completedAt and notifies', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...inReviewRequest(),
        column: COLUMNS[1],
      });
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-done' });

      const result = await service.move(DESIGNER, 'req-1', { direction: 'FORWARD' });

      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ columnId: 'col-done', completedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.appNotification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId_dedupeKey: {
              accountId: 'account-1',
              dedupeKey: 'design_request_ready:req-1',
            },
          },
          create: expect.objectContaining({
            type: AppNotificationType.DESIGN_REQUEST_READY,
            leadId: 'lead-1',
          }),
        }),
      );
      expect(result).toEqual({ id: 'req-1', columnId: 'col-done' });
      expect(chatEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'design_request.moved',
          payload: expect.objectContaining({ designRequestId: 'req-1', toColumnId: 'col-done' }),
        }),
      );
    });

    it('moves the card backward without triggering a notification', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...inReviewRequest(),
        column: COLUMNS[1],
      });
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-new' });

      await service.move(MANAGER, 'req-1', { direction: 'BACKWARD' });

      expect(prisma.appNotification.upsert).not.toHaveBeenCalled();
    });
  });

  // ADR-004 Submódulo 4: "Modificación" no es parte del movimiento
  // genérico ±1 -- solo se alcanza vía sendToModification().
  describe('move — "Modificación" nunca se alcanza por ±1 (Submódulo 4)', () => {
    it('skips "Modificación" and lands on "En revisión" when moving forward from "Bocetos nuevos"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        assignedUserId: null,
        column: COLUMNS[0],
        board: board(),
      });
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-review' });

      await service.move(MANAGER, 'req-1', { direction: 'FORWARD' });

      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ columnId: 'col-review' }) }),
      );
    });

    it('lets a card already in "Modificación" advance normally (±1) back to "En revisión"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        assignedUserId: 'designer-1',
        column: COLUMNS[4],
        board: board(),
      });
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-review' });

      await service.move(DESIGNER, 'req-1', { direction: 'FORWARD' });

      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ columnId: 'col-review' }) }),
      );
    });

    it('lets a card in "Modificación" move backward to "Bocetos nuevos"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        assignedUserId: 'designer-1',
        column: COLUMNS[4],
        board: board(),
      });
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-new' });

      await service.move(DESIGNER, 'req-1', { direction: 'BACKWARD' });

      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ columnId: 'col-new' }) }),
      );
    });
  });

  // ---------------------------------------------------------------
  // sendToModification (ADR-004 Submódulo 4)
  // ---------------------------------------------------------------

  describe('sendToModification', () => {
    function doneRequest() {
      return {
        id: 'req-1',
        createdByUserId: 'sales-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        assignedUserId: 'designer-1',
        column: COLUMNS[2], // DONE / isFinal
        board: board(),
      };
    }

    it('forbids a DESIGNER', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());

      await expect(service.sendToModification(DESIGNER, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("forbids a SALES who doesn't own the request", async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());

      await expect(service.sendToModification(OTHER_SALES, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects a request that is not in the "isFinal" column', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...doneRequest(),
        column: COLUMNS[1], // IN_REVIEW, not final
      });

      await expect(service.sendToModification(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when the board has no "Modificación" column configured', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...doneRequest(),
        board: { ...board(), columns: COLUMNS.slice(0, 4) },
      });

      await expect(service.sendToModification(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('moves the owning SALES\'s request to "Modificación", recalculating the SLA', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());
      businessDaysService.loadHolidaySet.mockResolvedValue(new Set());
      businessDaysService.computeBusinessDueAt.mockReturnValue(new Date('2026-01-13T13:00:00.000Z'));
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-modification' });

      const result = await service.sendToModification(SALES, 'req-1');

      expect(businessDaysService.computeBusinessDueAt).toHaveBeenCalledWith(
        expect.any(Date),
        1,
        expect.any(Set),
        { cutoffHour: 14 },
      );
      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            columnId: 'col-modification',
            slaBusinessDays: 1,
            dueAt: new Date('2026-01-13T13:00:00.000Z'),
            sentToModificationAt: expect.any(Date),
            overdueLabelAppliedAt: null,
          }),
        }),
      );
      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            designRequestId: 'req-1',
            fromColumnId: 'col-done',
            toColumnId: 'col-modification',
            direction: 'SENT_TO_MODIFICATION',
            changedByUserId: 'sales-1',
          }),
        }),
      );
      expect(result).toEqual({ id: 'req-1', columnId: 'col-modification' });

      expect(prisma.appNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'account-1',
            leadId: 'lead-1',
            type: AppNotificationType.DESIGN_REQUEST_SENT_TO_MODIFICATION,
          }),
        }),
      );
    });

    it('lets DESIGNER_MANAGER/ADMIN send any request to "Modificación"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());
      businessDaysService.loadHolidaySet.mockResolvedValue(new Set());
      businessDaysService.computeBusinessDueAt.mockReturnValue(new Date('2026-01-13T13:00:00.000Z'));
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-modification' });

      await expect(service.sendToModification(MANAGER, 'req-1')).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // addComment
  // ---------------------------------------------------------------

  describe('addComment', () => {
    function reviewRequest() {
      return {
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        createdByUserId: 'sales-1',
        assignedUserId: 'designer-1',
        column: COLUMNS[1],
        board: board(),
      };
    }

    it('lets the owning SALES comment', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestComment.create.mockResolvedValue({ id: 'c-1' });

      const result = await service.addComment(SALES, 'req-1', { body: 'hola' });

      expect(prisma.designRequestComment.create).toHaveBeenCalledWith({
        data: {
          designRequestId: 'req-1',
          authorUserId: 'sales-1',
          body: 'hola',
          attachments: undefined,
        },
        include: { attachments: true },
      });
      expect(result).toEqual({ id: 'c-1' });
    });

    it('creates the comment attachments (ADR-004 Submódulo 3)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestComment.create.mockResolvedValue({
        id: 'c-1',
        attachments: [{ id: 'att-1' }],
      });

      const result = await service.addComment(SALES, 'req-1', {
        body: 'aquí va el archivo',
        attachments: [
          { kind: DesignAttachmentKind.FROM_CHAT, sourceMessageId: 'msg-1' },
        ],
      });

      expect(prisma.designRequestComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: {
              create: [
                expect.objectContaining({
                  kind: DesignAttachmentKind.FROM_CHAT,
                  sourceMessageId: 'msg-1',
                  uploadedByUserId: 'sales-1',
                }),
              ],
            },
          }),
          include: { attachments: true },
        }),
      );
      expect(result).toEqual({ id: 'c-1', attachments: [{ id: 'att-1' }] });
    });

    it('blocks a SALES user who did not create the request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());

      await expect(
        service.addComment(OTHER_SALES, 'req-1', { body: 'hola' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks a DESIGNER who is not the assignee', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());

      await expect(
        service.addComment(OTHER_DESIGNER, 'req-1', { body: 'hola' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets DESIGNER_MANAGER and ADMIN comment on any request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestComment.create.mockResolvedValue({ id: 'c-2' });

      await service.addComment(MANAGER, 'req-1', { body: 'ok' });
      await service.addComment(ADMIN, 'req-1', { body: 'ok' });

      expect(prisma.designRequestComment.create).toHaveBeenCalledTimes(2);
    });

    it('notifies "the other party" for every comment (ADR-004 Submódulo 6)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestComment.create.mockResolvedValue({ id: 'c-3' });

      await service.addComment(SALES, 'req-1', { body: 'hola' });

      expect(prisma.appNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'account-1',
            leadId: 'lead-1',
            type: AppNotificationType.DESIGN_REQUEST_COMMENTED,
            dedupeKey: 'design_request_commented:c-3',
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------
  // approve
  // ---------------------------------------------------------------

  describe('approve', () => {
    function doneRequest() {
      return {
        id: 'req-1',
        createdByUserId: 'sales-1',
        column: COLUMNS[2],
        board: board(),
      };
    }

    it('rejects a SALES user who did not create the request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());

      await expect(service.approve(OTHER_SALES, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects approving a request that is not in the final column', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...doneRequest(),
        column: COLUMNS[1],
      });

      await expect(service.approve(SALES, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('approves the request: moves it to "Aprobados" and stamps approvedAt', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-approved' });

      const result = await service.approve(SALES, 'req-1');

      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ columnId: 'col-approved', approvedAt: expect.any(Date) }),
        }),
      );
      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromColumnId: 'col-done',
            toColumnId: 'col-approved',
            direction: 'FORWARD',
          }),
        }),
      );
      expect(result).toEqual({ id: 'req-1', columnId: 'col-approved' });
    });

    it('lets DESIGNER_MANAGER/ADMIN approve any request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-approved' });

      await service.approve(MANAGER, 'req-1');
      await service.approve(ADMIN, 'req-1');

      expect(tx.designRequest.update).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------
  // slaStatus (semáforo de 3 colores, ADR-004 §8 / Submódulo 1)
  // ---------------------------------------------------------------

  describe('slaStatus (semáforo de 3 colores)', () => {
    it('listRequests marks a request past its dueAt as RED, regardless of business days remaining', async () => {
      const overdue = {
        id: 'req-1',
        dueAt: new Date(Date.now() - 60 * 60 * 1000),
        completedAt: null,
      };
      const dueSoon = {
        id: 'req-2',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
      };
      const dueLater = {
        id: 'req-3',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
      };
      const closed = {
        id: 'req-4',
        dueAt: new Date(Date.now() - 60 * 60 * 1000),
        completedAt: new Date(),
      };
      prisma.designRequest.findMany.mockResolvedValue([
        overdue,
        dueSoon,
        dueLater,
        closed,
      ]);
      businessDaysService.businessDaysUntilDue
        .mockReturnValueOnce(1) // dueSoon: vence hoy/mañana hábil -> ORANGE
        .mockReturnValueOnce(3); // dueLater: sobran días hábiles -> GREEN

      const result = await service.listRequests(SALES, {});

      expect(result).toEqual([
        { ...overdue, slaStatus: 'RED' },
        { ...dueSoon, slaStatus: 'ORANGE' },
        { ...dueLater, slaStatus: 'GREEN' },
        { ...closed, slaStatus: 'CLOSED' },
      ]);
      expect(businessDaysService.loadHolidaySet).toHaveBeenCalled();
    });

    it('getRequestDetail attaches the computed slaStatus using days-until-due from BusinessDaysService', async () => {
      const request = {
        id: 'req-1',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
      };
      prisma.designRequest.findFirst.mockResolvedValue(request);
      businessDaysService.businessDaysUntilDue.mockReturnValue(2);

      const result = await service.getRequestDetail(SALES, 'req-1');

      expect(result).toEqual({ ...request, slaStatus: 'GREEN' });
    });

    it('freezes the color at the pause moment (ADR-004 Submódulo 5): a paused request past its real dueAt stays GREEN', async () => {
      // El plazo real ya venció (dueAt en el pasado respecto a "ahora"),
      // pero la tarjeta se pausó ANTES de vencer -- el semáforo debe
      // seguir mostrando lo que era en el instante de la pausa (GREEN),
      // no RED.
      const pausedAt = new Date(Date.now() - 60 * 60 * 1000);
      const request = {
        id: 'req-1',
        dueAt: new Date(Date.now() - 30 * 60 * 1000), // ya venció "ahora"
        completedAt: null,
        pausedAt,
      };
      prisma.designRequest.findFirst.mockResolvedValue(request);
      businessDaysService.businessDaysUntilDue.mockReturnValue(3);

      const result = await service.getRequestDetail(SALES, 'req-1');

      expect(result.slaStatus).toBe('GREEN');
      expect(businessDaysService.businessDaysUntilDue).toHaveBeenCalledWith(
        pausedAt,
        request.dueAt,
        expect.any(Set),
      );
    });
  });

  // ---------------------------------------------------------------
  // archive ("Marcar como hecho" -- ADR-004 Submódulo 8)
  // ---------------------------------------------------------------

  describe('archive', () => {
    function approvedRequest() {
      return {
        id: 'req-1',
        column: COLUMNS[3], // col-approved
        board: board(),
        archivedAt: null,
      };
    }

    it('rejects roles other than DESIGNER_MANAGER/ADMIN', async () => {
      await expect(service.archive(SALES, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.designRequest.findUnique).not.toHaveBeenCalled();
    });

    it('rejects archiving a request that is not in "Aprobados"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        column: COLUMNS[2], // col-done
        board: board(),
        archivedAt: null,
      });

      await expect(service.archive(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects archiving an already-archived request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...approvedRequest(),
        archivedAt: new Date(),
      });

      await expect(service.archive(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('archives the request and stamps archivedByUserId', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(approvedRequest());
      prisma.designRequest.update.mockResolvedValue({
        id: 'req-1',
        archivedAt: new Date(),
      });

      const result = await service.archive(MANAGER, 'req-1');

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { archivedAt: expect.any(Date), archivedByUserId: 'manager-1' },
      });
      expect(result).toEqual({ id: 'req-1', archivedAt: expect.any(Date) });
    });

    it('lets ADMIN archive too', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(approvedRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.archive(ADMIN, 'req-1');

      expect(prisma.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ archivedByUserId: 'admin-1' }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------
  // pause / resume (ADR-004 Submódulo 5)
  // ---------------------------------------------------------------

  describe('pause', () => {
    function activeRequest() {
      return {
        id: 'req-1',
        column: COLUMNS[1], // col-review
        board: board(),
        completedAt: null,
        archivedAt: null,
        pausedAt: null,
      };
    }

    it('rejects roles other than DESIGNER_MANAGER/ADMIN', async () => {
      await expect(service.pause(SALES, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects pausing a request that already left the active flow (completed)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...activeRequest(),
        completedAt: new Date(),
      });

      await expect(service.pause(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects pausing an already-archived request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...activeRequest(),
        archivedAt: new Date(),
      });

      await expect(service.pause(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects pausing an already-paused request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...activeRequest(),
        pausedAt: new Date(),
      });

      await expect(service.pause(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('stamps pausedAt/pausedByUserId and records a PAUSED status event', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(activeRequest());
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', pausedAt: new Date() });

      const result = await service.pause(MANAGER, 'req-1');

      expect(tx.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { pausedAt: expect.any(Date), pausedByUserId: 'manager-1' },
      });
      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            designRequestId: 'req-1',
            direction: 'PAUSED',
            changedByUserId: 'manager-1',
          }),
        }),
      );
      expect(result).toEqual({ id: 'req-1', pausedAt: expect.any(Date) });
    });
  });

  describe('resume', () => {
    function pausedRequest() {
      return {
        id: 'req-1',
        column: COLUMNS[1],
        board: board(),
        pausedAt: new Date('2026-01-13T10:00:00.000Z'),
        pausedTotalMs: BigInt(0),
        dueAt: new Date('2026-01-15T13:00:00.000Z'),
      };
    }

    it('rejects roles other than DESIGNER_MANAGER/ADMIN', async () => {
      await expect(service.resume(SALES, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects resuming a request that is not paused', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...pausedRequest(),
        pausedAt: null,
      });

      await expect(service.resume(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('shifts dueAt forward by the real elapsed pause time and clears pausedAt', async () => {
      const fixedNow = new Date('2026-01-13T12:00:00.000Z'); // 2h after pausedAt
      jest.useFakeTimers().setSystemTime(fixedNow);

      prisma.designRequest.findUnique.mockResolvedValue(pausedRequest());
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', dueAt: new Date() });

      await service.resume(MANAGER, 'req-1');

      const twoHoursMs = 2 * 60 * 60 * 1000;
      expect(tx.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          pausedAt: null,
          pausedByUserId: null,
          pausedTotalMs: BigInt(twoHoursMs),
          dueAt: new Date(new Date('2026-01-15T13:00:00.000Z').getTime() + twoHoursMs),
        },
      });
      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            designRequestId: 'req-1',
            direction: 'RESUMED',
            changedByUserId: 'manager-1',
          }),
        }),
      );

      jest.useRealTimers();
    });
  });

  // ---------------------------------------------------------------
  // getReportsSummary (ADR-004 Submódulo 10)
  // ---------------------------------------------------------------

  describe('getReportsSummary', () => {
    it('rejects roles other than DESIGNER_MANAGER/ADMIN', async () => {
      await expect(service.getReportsSummary(SALES, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.designRequest.count).not.toHaveBeenCalled();
    });

    it('aggregates completed/approved counts, breakdowns, and the approval rate for the given month', async () => {
      prisma.designRequest.count
        .mockResolvedValueOnce(10) // completedCount
        .mockResolvedValueOnce(4); // approvedCount
      prisma.designRequest.groupBy
        .mockResolvedValueOnce([
          { country: 'ES', _count: { _all: 3 } },
          { country: 'FR', _count: { _all: 1 } },
        ])
        .mockResolvedValueOnce([
          { createdByUserId: 'sales-1', _count: { _all: 2 } },
          { createdByUserId: 'sales-2', _count: { _all: 2 } },
        ]);

      const result = await service.getReportsSummary(MANAGER, { month: '2026-01' });

      expect(result).toEqual({
        month: '2026-01',
        completedCount: 10,
        approvedCount: 4,
        approvalRate: 40,
        approvedByCountry: [
          { country: 'ES', count: 3 },
          { country: 'FR', count: 1 },
        ],
        approvedByCreator: [
          { createdByUserId: 'sales-1', count: 2 },
          { createdByUserId: 'sales-2', count: 2 },
        ],
      });
      expect(prisma.designRequest.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { completedAt: { gte: expect.any(Date), lt: expect.any(Date) } },
        }),
      );
    });

    it('returns a 0% approval rate when nothing was completed in the period (avoids dividing by zero)', async () => {
      prisma.designRequest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.designRequest.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.getReportsSummary(ADMIN, { month: '2026-02' });

      expect(result.approvalRate).toBe(0);
    });

    it('defaults to the current month when none is given', async () => {
      prisma.designRequest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.designRequest.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.getReportsSummary(MANAGER, {});

      expect(result.month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  // ---------------------------------------------------------------
  // approveByLabel (ADR-004 Submódulo 2: aprobación automática por etiqueta)
  // ---------------------------------------------------------------

  describe('approveByLabel', () => {
    it('blocks (throws) when there is no request in "Boceto terminado" waiting for approval', async () => {
      prisma.designRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.approveByLabel('account-1', 'lead-1', 'sales-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('moves the request in "Terminado" to "Aprobados" and marks approvedViaLabel', async () => {
      prisma.designRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        column: COLUMNS[2],
        board: board(),
      });
      tx.designRequest.update.mockResolvedValue({
        id: 'req-1',
        columnId: 'col-approved',
        approvedViaLabel: true,
      });

      const result = await service.approveByLabel(
        'account-1',
        'lead-1',
        'sales-1',
      );

      expect(prisma.designRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId: 'account-1',
            leadId: 'lead-1',
            approvedAt: null,
            column: { isFinal: true },
          },
        }),
      );
      expect(tx.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          columnId: 'col-approved',
          approvedAt: expect.any(Date),
          approvedViaLabel: true,
        },
      });
      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith({
        data: {
          designRequestId: 'req-1',
          fromColumnId: 'col-done',
          toColumnId: 'col-approved',
          direction: 'AUTO_APPROVED',
          changedByUserId: 'sales-1',
        },
      });
      expect(result).toEqual({
        id: 'req-1',
        columnId: 'col-approved',
        approvedViaLabel: true,
      });
    });

    it('works without a userId (system/automatic call)', async () => {
      prisma.designRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        column: COLUMNS[2],
        board: board(),
      });
      tx.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.approveByLabel('account-1', 'lead-1');

      expect(tx.designRequestStatusEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changedByUserId: null }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------
  // forwardAttachment ("reenviar al lead")
  // ---------------------------------------------------------------

  describe('forwardAttachment', () => {
    function reviewRequest() {
      return {
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        createdByUserId: 'sales-1',
        column: COLUMNS[2],
        board: board(),
      };
    }

    it('blocks a SALES user who did not create the request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());

      await expect(
        service.forwardAttachment(OTHER_SALES, 'req-1', 'att-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.designRequestAttachment.findFirst).not.toHaveBeenCalled();
    });

    it('blocks roles other than the owning SALES or ADMIN', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());

      await expect(
        service.forwardAttachment(MANAGER, 'req-1', 'att-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound when the attachment does not belong to the request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestAttachment.findFirst.mockResolvedValue(null);

      await expect(
        service.forwardAttachment(SALES, 'req-1', 'att-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an attachment without a media file', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        mediaUrl: null,
      });

      await expect(
        service.forwardAttachment(SALES, 'req-1', 'att-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sends the attachment via OutboundService and stamps forwardedToLeadAt, inferring the media type from the mime type', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        mediaUrl: 'https://cdn.example.com/boceto.png',
        mediaStorageKey: 'boceto.png',
        mimeType: 'image/png',
        fileName: 'boceto.png',
        sizeBytes: 1234,
      });
      prisma.designRequestAttachment.update.mockResolvedValue({});

      const result = await service.forwardAttachment(SALES, 'req-1', 'att-1');

      expect(outboundService.sendMediaMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'account-1',
          leadId: 'lead-1',
          type: 'image',
          mediaUrl: 'https://cdn.example.com/boceto.png',
          fileName: 'boceto.png',
        }),
      );
      expect(prisma.designRequestAttachment.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: { forwardedToLeadAt: expect.any(Date) },
      });
      expect(result).toEqual({ id: 'msg-1' });
    });

    it('defaults to "document" when the attachment has no mime type', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        mediaUrl: 'https://cdn.example.com/boceto.pdf',
        mediaStorageKey: null,
        mimeType: null,
        fileName: 'boceto.pdf',
        sizeBytes: 999,
      });
      prisma.designRequestAttachment.update.mockResolvedValue({});

      await service.forwardAttachment(SALES, 'req-1', 'att-1');

      expect(outboundService.sendMediaMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'document' }),
      );
    });

    it('lets ADMIN forward an attachment on any request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(reviewRequest());
      prisma.designRequestAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        mediaUrl: 'https://cdn.example.com/boceto.mp4',
        mediaStorageKey: null,
        mimeType: 'video/mp4',
        fileName: 'boceto.mp4',
        sizeBytes: 555,
      });
      prisma.designRequestAttachment.update.mockResolvedValue({});

      await service.forwardAttachment(ADMIN, 'req-1', 'att-1');

      expect(outboundService.sendMediaMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'video' }),
      );
    });
  });
});
