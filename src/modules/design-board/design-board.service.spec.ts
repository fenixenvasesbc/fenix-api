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
// SALES_MANAGER: en el modulo de bocetos se comporta EXACTAMENTE igual
// que SALES (pedido explicito del usuario, ver DesignBoardService.
// isSalesLike()) -- pasa el guard del controller via ROLE_INHERITANCE,
// pero createRequest() tenia un chequeo literal propio que lo bloqueaba
// de todas formas. Una vez corregido ese chequeo, sigue acotado a su
// propia cuenta igual que SALES (a diferencia de otros modulos como
// Leads, donde SALES_MANAGER si tiene mas alcance).
const SALES_MANAGER: AuthUser = { userId: 'sales-mgr-1', role: Role.SALES_MANAGER, accountId: 'account-1' };
const DESIGNER: AuthUser = { userId: 'designer-1', role: Role.DESIGNER, accountId: null };
const OTHER_DESIGNER: AuthUser = { userId: 'designer-2', role: Role.DESIGNER, accountId: null };
const MANAGER: AuthUser = { userId: 'manager-1', role: Role.DESIGNER_MANAGER, accountId: null };

const COLUMNS = [
  { id: 'col-new', boardId: 'board-1', code: 'NEW', name: 'Bocetos nuevos', sortOrder: 0, isInitial: true, isModification: false, isInReview: false, isFinal: false, isApproved: false, modificationSlaBusinessDays: null },
  { id: 'col-review', boardId: 'board-1', code: 'IN_REVIEW', name: 'Boceto en revisión', sortOrder: 1, isInitial: false, isModification: false, isInReview: true, isFinal: false, isApproved: false, modificationSlaBusinessDays: null },
  { id: 'col-done', boardId: 'board-1', code: 'DONE', name: 'Boceto terminado', sortOrder: 2, isInitial: false, isModification: false, isInReview: false, isFinal: true, isApproved: false, modificationSlaBusinessDays: null },
  { id: 'col-approved', boardId: 'board-1', code: 'APPROVED', name: 'Aprobados', sortOrder: 3, isInitial: false, isModification: false, isInReview: false, isFinal: false, isApproved: true, modificationSlaBusinessDays: null },
  // ADR-004 Submódulo 4: sortOrder 0.5 la coloca, al reordenar, entre "NEW"
  // (0) y "IN_REVIEW" (1) -- solo relevante para los tests que resuelven
  // el orden real vía move()/sendToModification(); los índices COLUMNS[0..3]
  // de arriba se mantienen intactos para no tocar el resto de este archivo.
  { id: 'col-modification', boardId: 'board-1', code: 'MODIFICATION', name: 'Modificación', sortOrder: 0.5, isInitial: false, isModification: true, isInReview: false, isFinal: false, isApproved: false, modificationSlaBusinessDays: 1 },
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
    designRequestComment: { create: jest.Mock; groupBy: jest.Mock };
    designRequestCommentView: { findMany: jest.Mock; upsert: jest.Mock };
    designRequestAttachment: { findFirst: jest.Mock; update: jest.Mock };
    appNotification: { upsert: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock; findMany: jest.Mock };
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
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      designRequestStatusEvent: { create: jest.fn() },
      designRequestComment: { create: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      designRequestCommentView: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      designRequestAttachment: { findFirst: jest.fn(), update: jest.fn() },
      appNotification: { upsert: jest.fn(), create: jest.fn() },
      user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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

    it('lets SALES_MANAGER create a request for its own account (regression: literal role check used to reject it even though the controller guard allows it via ROLE_INHERITANCE)', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', accountId: 'account-1' });
      prisma.designBoard.findFirst.mockResolvedValue(board());
      tx.designRequest.create.mockResolvedValue({ id: 'req-3' });

      await service.createRequest(SALES_MANAGER, dto);

      expect(tx.designRequest.create).toHaveBeenCalled();
    });

    it('throws Forbidden if SALES_MANAGER tries to create a request for a lead of another account (same restriction as SALES in this module)', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'lead-9', accountId: 'account-9' });

      await expect(service.createRequest(SALES_MANAGER, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ---------------------------------------------------------------
  // updateRequest (editar titulo/instrucciones -- pedido explicito del
  // cliente: la comercial propietaria puede corregir la solicitud ya
  // enviada sin crear una nueva ni depender del diseñador)
  // ---------------------------------------------------------------

  describe('updateRequest', () => {
    function ownedRequest(overrides: Record<string, unknown> = {}) {
      return {
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        createdByUserId: 'sales-1',
        archivedAt: null,
        column: COLUMNS[0],
        board: board(),
        ...overrides,
      };
    }

    it('rejects when no editable field is provided', async () => {
      await expect(service.updateRequest(SALES, 'req-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.designRequest.findUnique).not.toHaveBeenCalled();
    });

    it("forbids a SALES user who doesn't own the request", async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());

      await expect(
        service.updateRequest(OTHER_SALES, 'req-1', { title: 'Nuevo titulo' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids DESIGNER/DESIGNER_MANAGER entirely (only the owning SALES or ADMIN)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());

      await expect(
        service.updateRequest(MANAGER, 'req-1', { title: 'Nuevo titulo' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects editing an already-archived request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(
        ownedRequest({ archivedAt: new Date('2026-01-01T00:00:00.000Z') }),
      );

      await expect(
        service.updateRequest(SALES, 'req-1', { title: 'Nuevo titulo' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets the owning SALES update the title, trimmed', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1', title: 'Boceto corregido' });

      const result = await service.updateRequest(SALES, 'req-1', {
        title: '  Boceto corregido  ',
      });

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { title: 'Boceto corregido' },
      });
      expect(result).toEqual({ id: 'req-1', title: 'Boceto corregido' });
    });

    it('lets ADMIN update instructions, and clearing it to blank stores null', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.updateRequest(ADMIN, 'req-1', { instructions: '   ' });

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { instructions: null },
      });
    });

    it('does not recompute slaBusinessDays/dueAt even if instructions mentions an extended-SLA product', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.updateRequest(SALES, 'req-1', {
        instructions: 'Repetición con producto de plazo extendido',
      });

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { instructions: 'Repetición con producto de plazo extendido' },
      });
      expect(businessDaysService.computeBusinessDueAt).not.toHaveBeenCalled();
    });

    it('emits design_request.updated', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.updateRequest(SALES, 'req-1', { title: 'X' });

      expect(chatEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'design_request.updated' }),
      );
    });

    it('lets the owning SALES_MANAGER update its own request too (parity with SALES in this module)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(
        ownedRequest({ createdByUserId: 'sales-mgr-1' }),
      );
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1', title: 'Nuevo' });

      await service.updateRequest(SALES_MANAGER, 'req-1', { title: 'Nuevo' });

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { title: 'Nuevo' },
      });
    });

    it('lets the owning SALES update country', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.updateRequest(SALES, 'req-1', { country: DesignRequestCountry.FR });

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { country: DesignRequestCountry.FR },
      });
    });

    it('re-sending the same requestType the request already has does not recompute the deadline (comparing null as BOCETO for requests created before this field existed)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedRequest({ requestType: null }));
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.updateRequest(SALES, 'req-1', { requestType: 'BOCETO' });

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { requestType: 'BOCETO' },
      });
      expect(businessDaysService.computeBusinessDueAt).not.toHaveBeenCalled();
    });

    it('changing requestType to a different one recomputes slaBusinessDays/dueAt from now, using the same rules as creation', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(
        ownedRequest({ requestType: 'BOCETO', instructions: null }),
      );
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.updateRequest(SALES, 'req-1', { requestType: 'MOD' });

      expect(businessDaysService.computeBusinessDueAt).toHaveBeenCalledWith(
        expect.any(Date),
        1,
        expect.any(Set),
        { cutoffHour: 14 },
      );
      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          requestType: 'MOD',
          slaBusinessDays: 1,
          dueAt: new Date('2026-10-01T13:00:00.000Z'),
        },
      });
    });
    // ---------------------------------------------------------------
    // Plazos diferenciados por tipo de solicitud (resolveCreationSlaBusinessDays,
    // acordado con el cliente 02/oct/2026; actualizado 06/oct/2026: el tipo
    // ya no se infiere del titulo, se elige explicitamente via
    // dto.requestType). Se prueba a traves de createRequest() -- el metodo
    // es privado -- verificando con que slaBusinessDays se llama a
    // computeBusinessDueAt() y con que valor queda el create() de Prisma.
    // El default del tablero en board() es 3.
    // ---------------------------------------------------------------
    describe('plazos por tipo de solicitud (requestType elegido en el modal / producto extendido en la descripcion)', () => {
      beforeEach(() => {
        prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', accountId: 'account-1' });
        prisma.designBoard.findFirst.mockResolvedValue(board());
        tx.designRequest.create.mockResolvedValue({ id: 'req-sla', columnId: 'col-new', attachments: [] });
      });

      async function createAndGetSlaBusinessDays(
        requestType?: 'BOCETO' | 'MOD' | 'REPET_BOCETO' | 'REPET_MOD' | 'REPET_ANADE',
        instructions?: string,
      ) {
        await service.createRequest(SALES, {
          leadId: 'lead-1',
          title: 'Pepe Cliente - Jose',
          requestType,
          instructions,
        });
        const dueAtCall = businessDaysService.computeBusinessDueAt.mock.calls.at(-1)!;
        const createCall = tx.designRequest.create.mock.calls.at(-1)![0];
        // Ambos deben coincidir siempre -- es el mismo valor pasado dos veces.
        expect(dueAtCall[1]).toBe(createCall.data.slaBusinessDays);
        return createCall.data.slaBusinessDays as number;
      }

      it('BOCETO (sin producto extendido) usa el default del tablero: 3 dias', async () => {
        await expect(createAndGetSlaBusinessDays('BOCETO')).resolves.toBe(3);
      });

      it('sin requestType (no se manda) se trata igual que BOCETO: 3 dias', async () => {
        await expect(createAndGetSlaBusinessDays(undefined)).resolves.toBe(3);
      });

      it('MOD usa 1 dia (mismo plazo que REPET_MOD/REPET_ANADE)', async () => {
        await expect(createAndGetSlaBusinessDays('MOD')).resolves.toBe(1);
      });

      it('REPET_BOCETO usa 2 dias', async () => {
        await expect(createAndGetSlaBusinessDays('REPET_BOCETO')).resolves.toBe(2);
      });

      it('REPET_MOD usa 1 dia', async () => {
        await expect(createAndGetSlaBusinessDays('REPET_MOD')).resolves.toBe(1);
      });

      it('REPET_ANADE usa 1 dia', async () => {
        await expect(createAndGetSlaBusinessDays('REPET_ANADE')).resolves.toBe(1);
      });

      it.each([
        ['vasos', 'Cliente nuevo pide vasos de 8 onzas'],
        ['vaso (singular)', 'Cliente nuevo pide un vaso de 8 onzas'],
        ['palas', 'Boceto de palas para heladeria'],
        ['paninis', 'Pedido de paninis con logo'],
        ['hamburguesa folding', 'Caja hamburguesa folding con logo'],
        ['ensaladeras', 'Cliente quiere ensaladeras recicladas'],
        ['mayusculas', 'PEDIDO DE VASOS GRANDES'],
        ['con tilde/mayus random', 'Vasos Para El Cliente'],
      ])('BOCETO con producto de plazo extendido en la descripcion (%s) usa 4 dias', async (_case, instructions) => {
        await expect(createAndGetSlaBusinessDays('BOCETO', instructions)).resolves.toBe(4);
      });

      it('BOCETO sin producto de plazo extendido en la descripcion usa el default de 3 dias', async () => {
        await expect(
          createAndGetSlaBusinessDays('BOCETO', 'Caja de envio 35x24 con logo'),
        ).resolves.toBe(3);
      });

      it('sin instructions (undefined) no rompe y usa el default de 3 dias', async () => {
        await expect(createAndGetSlaBusinessDays('BOCETO', undefined)).resolves.toBe(3);
      });

      it('sin requestType y con producto de plazo extendido en la descripcion tambien usa 4 dias', async () => {
        await expect(
          createAndGetSlaBusinessDays(undefined, 'Pide vasos nuevos'),
        ).resolves.toBe(4);
      });

      it('REPET_BOCETO con un producto de plazo extendido en la descripcion sigue usando 2 dias (el tipo elegido manda, no se suma la excepcion de 4 dias)', async () => {
        await expect(
          createAndGetSlaBusinessDays('REPET_BOCETO', 'Pide vasos nuevos con el mismo diseño'),
        ).resolves.toBe(2);
      });

      it('MOD / REPET_MOD / REPET_ANADE con un producto de plazo extendido en la descripcion siguen usando 1 dia (no se suma la excepcion)', async () => {
        await expect(
          createAndGetSlaBusinessDays('MOD', 'Pide vasos nuevos'),
        ).resolves.toBe(1);
        await expect(
          createAndGetSlaBusinessDays('REPET_MOD', 'Pide palas nuevas'),
        ).resolves.toBe(1);
        await expect(
          createAndGetSlaBusinessDays('REPET_ANADE', 'Pide ensaladeras nuevas'),
        ).resolves.toBe(1);
      });
    });
  });
  // ---------------------------------------------------------------
  // deleteRequest (eliminacion logica -- pedido explicito del usuario,
  // 23/oct/2026)
  // ---------------------------------------------------------------

  describe('deleteRequest', () => {
    function ownedInitialRequest(overrides: Record<string, unknown> = {}) {
      return {
        id: 'req-1',
        accountId: 'account-1',
        leadId: 'lead-1',
        createdByUserId: 'sales-1',
        archivedAt: null,
        column: COLUMNS[0], // isInitial: true ("Nuevos")
        board: board(),
        ...overrides,
      };
    }

    it("forbids a SALES user who doesn't own the request", async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedInitialRequest());

      await expect(service.deleteRequest(OTHER_SALES, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('forbids DESIGNER/DESIGNER_MANAGER entirely', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedInitialRequest());

      await expect(service.deleteRequest(MANAGER, 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects deleting a request that is no longer in "Nuevos" (e.g. already in Modificacion)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(
        ownedInitialRequest({ column: COLUMNS[4] }), // col-modification
      );

      await expect(service.deleteRequest(SALES, 'req-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lets the owning SALES delete its own request while still in "Nuevos"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedInitialRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      const result = await service.deleteRequest(SALES, 'req-1');

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { deletedAt: expect.any(Date), deletedByUserId: 'sales-1' },
      });
      expect(result).toEqual({ id: 'req-1' });
      expect(chatEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'design_request.updated' }),
      );
    });

    it('lets the owning SALES_MANAGER delete its own request too (parity with SALES in this module)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(
        ownedInitialRequest({ createdByUserId: 'sales-mgr-1' }),
      );
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.deleteRequest(SALES_MANAGER, 'req-1');

      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { deletedAt: expect.any(Date), deletedByUserId: 'sales-mgr-1' },
      });
    });

    it('lets ADMIN delete any request while still in "Nuevos"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(ownedInitialRequest());
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.deleteRequest(ADMIN, 'req-1');

      expect(prisma.designRequest.update).toHaveBeenCalled();
    });
  });


  // ---------------------------------------------------------------
  // listRequests / getRequestDetail (visibilidad por rol)
  // ---------------------------------------------------------------

  describe('listRequests', () => {
    it('scopes SALES to only their own requests within their account, their own columns (Nuevos/Modificacion/Terminado), excluding deleted/archivadas', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(SALES, { month: 'all' });

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdByUserId: 'sales-1',
            accountId: 'account-1',
            column: {
              OR: [{ isInitial: true }, { isModification: true }, { isFinal: true }],
            },
            deletedAt: null,
            archivedAt: null,
          },
        }),
      );
    });

    it('scopes SALES_MANAGER exactly like SALES in this module (pedido explicito del usuario, 23/oct/2026)', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(SALES_MANAGER, { month: 'all' });

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdByUserId: 'sales-mgr-1',
            accountId: 'account-1',
            column: {
              OR: [{ isInitial: true }, { isModification: true }, { isFinal: true }],
            },
            deletedAt: null,
            archivedAt: null,
          },
        }),
      );
    });

    it('scopes DESIGNER to only their assigned requests, excluding "Aprobados"', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(DESIGNER, { month: 'all' });

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignedUserId: 'designer-1',
            column: { isApproved: false },
            deletedAt: null,
            archivedAt: null,
          },
        }),
      );
    });

    it('excludes deleted/archived requests by default for DESIGNER_MANAGER/ADMIN, and includeArchived does not bring back deleted ones', async () => {
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, { month: 'all' });
      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null, archivedAt: null } }),
      );

      await service.listRequests(MANAGER, { includeArchived: true, month: 'all' });
      const call = prisma.designRequest.findMany.mock.calls[1][0];
      expect(call.where.deletedAt).toBeNull();
      expect(call.where.archivedAt).toBeUndefined();
    });

    it('lets DESIGNER_MANAGER filter by comercial/diseñador without restriction', async () => {
      prisma.designBoard.findFirst.mockResolvedValue(board());
      prisma.designRequest.findMany.mockResolvedValue([]);

      await service.listRequests(MANAGER, {
        assignedUserId: 'designer-9',
        createdByUserId: 'sales-9',
        columnId: 'col-new',
        month: 'all',
      });

      expect(prisma.designRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignedUserId: 'designer-9',
            createdByUserId: 'sales-9',
            deletedAt: null,
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

    // Pedido explicito del usuario, 23/oct/2026: filtro general del
    // tablero por mes (TODAS las columnas, segun createdAt) -- distinto
    // del filtro completedMonth de arriba (solo afecta "Terminado" via
    // columnId). Por defecto el mes actual; 'all' para ver todo; "YYYY-MM"
    // para un mes puntual, con el rango exacto del 1ro al ultimo dia de
    // ESE mes (28/29 para febrero, 30 o 31 segun corresponda).
    describe('filtro general por mes (createdAt)', () => {
      it('defaults to the current month when no month is given', async () => {
        prisma.designRequest.findMany.mockResolvedValue([]);

        await service.listRequests(MANAGER, {});

        const call = prisma.designRequest.findMany.mock.calls[0][0];
        expect(call.where.createdAt).toEqual({
          gte: expect.any(Date),
          lt: expect.any(Date),
        });
      });

      it('skips the filter entirely when month is "all"', async () => {
        prisma.designRequest.findMany.mockResolvedValue([]);

        await service.listRequests(MANAGER, { month: 'all' });

        const call = prisma.designRequest.findMany.mock.calls[0][0];
        expect(call.where.createdAt).toBeUndefined();
      });

      it('resolves an explicit "YYYY-MM" to the exact first-to-last-day range (31-day month)', async () => {
        prisma.designRequest.findMany.mockResolvedValue([]);

        await service.listRequests(MANAGER, { month: '2026-10' });

        const call = prisma.designRequest.findMany.mock.calls[0][0];
        expect(call.where.createdAt).toEqual({
          gte: new Date(Date.UTC(2026, 9, 1)),
          lt: new Date(Date.UTC(2026, 10, 1)),
        });
      });

      it('covers all 28 days of February in a non-leap year', async () => {
        prisma.designRequest.findMany.mockResolvedValue([]);

        await service.listRequests(MANAGER, { month: '2026-02' });

        const call = prisma.designRequest.findMany.mock.calls[0][0];
        expect(call.where.createdAt).toEqual({
          gte: new Date(Date.UTC(2026, 1, 1)),
          lt: new Date(Date.UTC(2026, 2, 1)),
        });
      });

      it('covers all 29 days of February in a leap year', async () => {
        prisma.designRequest.findMany.mockResolvedValue([]);

        await service.listRequests(MANAGER, { month: '2028-02' });

        const call = prisma.designRequest.findMany.mock.calls[0][0];
        expect(call.where.createdAt).toEqual({
          gte: new Date(Date.UTC(2028, 1, 1)),
          lt: new Date(Date.UTC(2028, 2, 1)),
        });
      });

      it('applies the same filter for SALES too, on top of their own visibility scope', async () => {
        prisma.designRequest.findMany.mockResolvedValue([]);

        await service.listRequests(SALES, { month: '2026-09' });

        const call = prisma.designRequest.findMany.mock.calls[0][0];
        expect(call.where.createdByUserId).toBe('sales-1');
        expect(call.where.createdAt).toEqual({
          gte: new Date(Date.UTC(2026, 8, 1)),
          lt: new Date(Date.UTC(2026, 9, 1)),
        });
      });
    });

    describe('hasNewComments (indicador de comentario nuevo por usuario)', () => {
      function requestFixture() {
        return {
          id: 'req-1',
          createdByUserId: 'sales-1',
          assignedUserId: null,
          dueAt: new Date(Date.now() + 60 * 60 * 1000),
          completedAt: null,
          lead: null,
        };
      }

      it('is true when someone else commented and this user never viewed the request', async () => {
        prisma.designRequest.findMany.mockResolvedValue([requestFixture()]);
        prisma.designRequestComment.groupBy.mockResolvedValue([
          { designRequestId: 'req-1', _max: { createdAt: new Date('2026-01-10T00:00:00.000Z') } },
        ]);
        prisma.designRequestCommentView.findMany.mockResolvedValue([]);

        const [result] = await service.listRequests(SALES, { month: 'all' });

        expect(result.hasNewComments).toBe(true);
        expect(prisma.designRequestComment.groupBy).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ authorUserId: { not: 'sales-1' } }),
          }),
        );
      });

      it('is true when someone else commented AFTER the last time this user viewed it', async () => {
        prisma.designRequest.findMany.mockResolvedValue([requestFixture()]);
        prisma.designRequestComment.groupBy.mockResolvedValue([
          { designRequestId: 'req-1', _max: { createdAt: new Date('2026-01-10T00:00:00.000Z') } },
        ]);
        prisma.designRequestCommentView.findMany.mockResolvedValue([
          { designRequestId: 'req-1', lastViewedAt: new Date('2026-01-01T00:00:00.000Z') },
        ]);

        const [result] = await service.listRequests(SALES, { month: 'all' });

        expect(result.hasNewComments).toBe(true);
      });

      it('is false when this user viewed it AFTER the last other-authored comment', async () => {
        prisma.designRequest.findMany.mockResolvedValue([requestFixture()]);
        prisma.designRequestComment.groupBy.mockResolvedValue([
          { designRequestId: 'req-1', _max: { createdAt: new Date('2026-01-10T00:00:00.000Z') } },
        ]);
        prisma.designRequestCommentView.findMany.mockResolvedValue([
          { designRequestId: 'req-1', lastViewedAt: new Date('2026-01-15T00:00:00.000Z') },
        ]);

        const [result] = await service.listRequests(SALES, { month: 'all' });

        expect(result.hasNewComments).toBe(false);
      });

      it('is false when there are no comments from anyone else (e.g. only the owner commented)', async () => {
        prisma.designRequest.findMany.mockResolvedValue([requestFixture()]);
        prisma.designRequestComment.groupBy.mockResolvedValue([]);
        prisma.designRequestCommentView.findMany.mockResolvedValue([]);

        const [result] = await service.listRequests(SALES, { month: 'all' });

        expect(result.hasNewComments).toBe(false);
      });
    });
  });

  describe('getRequestDetail', () => {
    it('returns the request when visible, with the computed slaStatus attached', async () => {
      const request = {
        id: 'req-1',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
        comments: [],
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

    // Pedido explicito del usuario, 26/oct/2026: abrir el detalle marca el
    // boceto como "visto" por ESTE usuario (limpia su propio indicador de
    // comentario nuevo en la card -- ver listRequests()/hasNewComments).
    it('marks the request as viewed by this user (upserts DesignRequestCommentView)', async () => {
      const request = {
        id: 'req-1',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
        comments: [],
      };
      prisma.designRequest.findFirst.mockResolvedValue(request);

      await service.getRequestDetail(SALES, 'req-1');

      expect(prisma.designRequestCommentView.upsert).toHaveBeenCalledWith({
        where: {
          designRequestId_userId: { designRequestId: 'req-1', userId: 'sales-1' },
        },
        update: { lastViewedAt: expect.any(Date) },
        create: { designRequestId: 'req-1', userId: 'sales-1' },
      });
    });

    it('does not fail the detail fetch when marking as viewed throws', async () => {
      const request = {
        id: 'req-1',
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        completedAt: null,
        comments: [],
      };
      prisma.designRequest.findFirst.mockResolvedValue(request);
      prisma.designRequestCommentView.upsert.mockRejectedValueOnce(new Error('db down'));

      const result = await service.getRequestDetail(SALES, 'req-1');

      expect(result).toEqual({ ...request, slaStatus: 'ON_TIME' });
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

    it('lets DESIGNER_MANAGER self-assign a request (pedido explicito del usuario, 23/oct/2026)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({ id: 'req-1', board: board(), column: COLUMNS[0] });
      prisma.user.findUnique.mockResolvedValue({ id: 'manager-1', role: Role.DESIGNER_MANAGER });
      prisma.designRequest.update.mockResolvedValue({ id: 'req-1', assignedUserId: 'manager-1' });

      const result = await service.assign(MANAGER, 'req-1', { assignedUserId: 'manager-1' });

      expect(prisma.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedUserId: 'manager-1',
            assignedByUserId: 'manager-1',
          }),
        }),
      );
      expect(result).toEqual({ id: 'req-1', assignedUserId: 'manager-1' });
    });

    it('does not let a DESIGNER_MANAGER assign a request to ANOTHER DESIGNER_MANAGER', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({ id: 'req-1', board: board(), column: COLUMNS[0] });
      prisma.user.findUnique.mockResolvedValue({ id: 'other-manager', role: Role.DESIGNER_MANAGER });

      await expect(
        service.assign(MANAGER, 'req-1', { assignedUserId: 'other-manager' }),
      ).rejects.toBeInstanceOf(BadRequestException);
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

    it('forbids SALES_MANAGER from moving cards too (parity with SALES in this module)', async () => {
      await expect(
        service.move(SALES_MANAGER, 'req-1', { direction: 'FORWARD' }),
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
            completedAt: null,
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

    // Regresión: antes de este fix, completedAt no se limpiaba al salir de
    // "Terminado" hacia "Modificación" -- quedaba con la fecha de la
    // primera vez que la tarjeta llego a "Terminado", y el filtro por mes
    // (listRequests, §Submódulo 9) y los reportes (getReportsSummary,
    // §Submódulo 10) la seguian contando como terminada ese mes aunque la
    // tarjeta ya no estuviera ahi. move() ya vuelve a setear completedAt
    // cuando reingresa a "Terminado" (ver test de move()), asi que
    // limpiarlo aca no pierde el dato cuando corresponde.
    it('clears completedAt so a request sent back to modification stops counting as "terminada" in reports until it completes again', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        ...doneRequest(),
        completedAt: new Date('2026-01-05T10:00:00.000Z'),
      });
      businessDaysService.loadHolidaySet.mockResolvedValue(new Set());
      businessDaysService.computeBusinessDueAt.mockReturnValue(new Date('2026-01-13T13:00:00.000Z'));
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-modification' });

      await service.sendToModification(MANAGER, 'req-1');

      expect(tx.designRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ completedAt: null }),
        }),
      );
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
        accountId: 'account-1',
        leadId: 'lead-1',
        createdByUserId: 'sales-1',
        assignedUserId: 'designer-1',
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

    // Pedido explicito del usuario, 23/oct/2026: al aprobar desde el
    // tablero, el lead debia dejar de mostrar "Boceto en proceso" --
    // currentLabel es un valor unico, asi que aplicar BOCETO_APROBADO
    // reemplaza/oculta BOCETO_EN_PROCESO (ver DesignBoardService.approve()).
    it('applies BOCETO_APROBADO to the lead so it stops showing "Boceto en proceso"', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(doneRequest());
      tx.designRequest.update.mockResolvedValue({ id: 'req-1', columnId: 'col-approved' });

      await service.approve(SALES, 'req-1');

      expect(leadsService.setLabel).toHaveBeenCalledWith({
        accountId: 'account-1',
        leadId: 'lead-1',
        label: SYSTEM_LABEL_CODES.BOCETO_APROBADO,
        changedByUserId: 'sales-1',
      });
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
    it('rejects roles other than DESIGNER_MANAGER/ADMIN/SALES_MANAGER', async () => {
      await expect(service.getReportsSummary(SALES, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.designRequest.count).not.toHaveBeenCalled();
    });

    it('rejects a plain DESIGNER too', async () => {
      await expect(service.getReportsSummary(DESIGNER, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    // Pedido explicito del usuario, 26/oct/2026: la jefa de ventas tambien
    // puede ver este reporte, igual que el Jefe de Diseño/Admin.
    it('allows SALES_MANAGER (la jefa de ventas) to see the report', async () => {
      prisma.designRequest.count.mockResolvedValue(0);
      prisma.designRequest.groupBy.mockResolvedValue([]);

      const result = await service.getReportsSummary(SALES_MANAGER, {});

      expect(result.months).toHaveLength(3);
    });

    function monthKeyFromGte(gte: Date): string {
      return `${gte.getUTCFullYear()}-${String(gte.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // Pedido explicito del usuario, 26/oct/2026: ya no se devuelve un
    // numero global para un rango -- se devuelven los ultimos 3 meses
    // SEPARADOS (el mas reciente = el mes que contiene dateTo, o el mes
    // actual si no se manda), cada uno con sus propios totales, desglose
    // por pais, y por comercial (terminados/aprobados/tasa de ESE
    // comercial en ESE mes, no solo un conteo de aprobados).
    it('returns the last 3 months (oldest to newest) ending at the month of dateTo, each with its own breakdown', async () => {
      const dataByMonth: Record<string, any> = {
        '2025-11': {
          completed: 2,
          approved: 1,
          country: [{ country: 'ES', _count: { _all: 1 } }],
          completedByCreator: [{ createdByUserId: 'sales-1', _count: { _all: 2 } }],
          approvedByCreator: [{ createdByUserId: 'sales-1', _count: { _all: 1 } }],
          completedRequests: [
            { id: 'req-1', title: 'Boceto cliente A', assignedUserId: 'designer-1' },
            { id: 'req-2', title: 'Boceto cliente B', assignedUserId: 'designer-1' },
          ],
        },
        '2025-12': {
          completed: 0,
          approved: 0,
          country: [],
          completedByCreator: [],
          approvedByCreator: [],
          completedRequests: [],
        },
        '2026-01': {
          completed: 5,
          approved: 5,
          country: [{ country: 'FR', _count: { _all: 5 } }],
          completedByCreator: [{ createdByUserId: 'sales-2', _count: { _all: 5 } }],
          approvedByCreator: [{ createdByUserId: 'sales-2', _count: { _all: 5 } }],
          completedRequests: [
            { id: 'req-3', title: 'Boceto cliente C', assignedUserId: 'designer-2' },
            { id: 'req-4', title: 'Boceto cliente D', assignedUserId: 'designer-2' },
            { id: 'req-5', title: 'Boceto cliente E', assignedUserId: null },
          ],
        },
      };

      prisma.designRequest.count.mockImplementation(async ({ where }: any) => {
        const key = monthKeyFromGte(where.completedAt.gte);
        return where.approvedAt ? dataByMonth[key].approved : dataByMonth[key].completed;
      });
      prisma.designRequest.groupBy.mockImplementation(async ({ by, where }: any) => {
        const key = monthKeyFromGte(where.completedAt.gte);
        if (by[0] === 'country') return dataByMonth[key].country;
        return where.approvedAt ? dataByMonth[key].approvedByCreator : dataByMonth[key].completedByCreator;
      });
      prisma.designRequest.findMany.mockImplementation(async ({ where }: any) => {
        const key = monthKeyFromGte(where.completedAt.gte);
        return dataByMonth[key].completedRequests;
      });

      const result = await service.getReportsSummary(MANAGER, { dateTo: '2026-01-15' });

      expect(result.months.map((m: any) => m.month)).toEqual(['2025-11', '2025-12', '2026-01']);

      const [nov, dec, jan] = result.months;

      expect(nov.completedCount).toBe(2);
      expect(nov.approvedCount).toBe(1);
      expect(nov.approvalRate).toBe(50);
      expect(nov.approvedByCountry).toEqual([{ country: 'ES', count: 1 }]);
      expect(nov.byCreator).toEqual([
        { createdByUserId: 'sales-1', completedCount: 2, approvedCount: 1, approvalRate: 50 },
      ]);
      // Historico de terminados por diseñador, con el nombre de cada
      // solicitud -- pedido explicito del usuario, 26/oct/2026.
      expect(nov.byDesigner).toEqual([
        {
          assignedUserId: 'designer-1',
          completedCount: 2,
          requests: [
            { id: 'req-1', title: 'Boceto cliente A' },
            { id: 'req-2', title: 'Boceto cliente B' },
          ],
        },
      ]);

      expect(dec.completedCount).toBe(0);
      expect(dec.approvalRate).toBe(0);
      expect(dec.byCreator).toEqual([]);
      expect(dec.byDesigner).toEqual([]);

      expect(jan.completedCount).toBe(5);
      expect(jan.approvedCount).toBe(5);
      expect(jan.approvalRate).toBe(100);
      expect(jan.byCreator).toEqual([
        { createdByUserId: 'sales-2', completedCount: 5, approvedCount: 5, approvalRate: 100 },
      ]);
      // Dos diseñadores distintos + una solicitud sin asignar, cada uno en
      // su propio grupo (la sin asignar no se pierde del total).
      expect(jan.byDesigner).toEqual([
        {
          assignedUserId: 'designer-2',
          completedCount: 2,
          requests: [
            { id: 'req-3', title: 'Boceto cliente C' },
            { id: 'req-4', title: 'Boceto cliente D' },
          ],
        },
        {
          assignedUserId: null,
          completedCount: 1,
          requests: [{ id: 'req-5', title: 'Boceto cliente E' }],
        },
      ]);
    });

    it('defaults to the current month as the end of the window when dateTo is not given', async () => {
      prisma.designRequest.count.mockResolvedValue(0);
      prisma.designRequest.groupBy.mockResolvedValue([]);

      const now = new Date();
      const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      const result = await service.getReportsSummary(MANAGER, {});

      expect(result.months).toHaveLength(3);
      expect(result.months[2].month).toBe(currentMonthKey);
    });

    it('ignores dateFrom entirely -- only the month of dateTo decides the 3-month window (pedido explicito del usuario, se conserva el filtro pero ya no acota)', async () => {
      prisma.designRequest.count.mockResolvedValue(0);
      prisma.designRequest.groupBy.mockResolvedValue([]);

      const result = await service.getReportsSummary(MANAGER, {
        dateFrom: '2020-01-01',
        dateTo: '2026-06-15',
      });

      expect(result.months.map((m: any) => m.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    });

    it("gives a creator a 0% rate (not NaN/undefined) when they completed requests but none were approved yet", async () => {
      prisma.designRequest.count.mockImplementation(async ({ where }: any) =>
        where.approvedAt ? 0 : 3,
      );
      prisma.designRequest.groupBy.mockImplementation(async ({ by, where }: any) => {
        if (by[0] === 'country') return [];
        if (where.approvedAt) return [];
        return [{ createdByUserId: 'sales-3', _count: { _all: 3 } }];
      });

      const result = await service.getReportsSummary(ADMIN, { dateTo: '2026-03-10' });

      expect(result.months[2].byCreator).toEqual([
        { createdByUserId: 'sales-3', completedCount: 3, approvedCount: 0, approvalRate: 0 },
      ]);
    });
  });

  // ---------------------------------------------------------------
  // getMyMonthlyApprovalRate (07/oct/2026): cada SALES ve su propia tasa
  // de aprobacion, desglosada mes por mes, de los ultimos 3 meses
  // (incluyendo el actual). Misma cohorte que getReportsSummary: cuenta
  // por completedAt del mes, "aprobado" = approvedAt no nulo.
  // ---------------------------------------------------------------

  describe('getMyMonthlyApprovalRate', () => {
    it('rejects roles other than SALES/SALES_MANAGER', async () => {
      await expect(
        service.getMyMonthlyApprovalRate(MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getMyMonthlyApprovalRate(ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.designRequest.count).not.toHaveBeenCalled();
    });

    it('allows SALES_MANAGER too (parity with SALES in this module -- regression: this used to 403 even though the controller guard already allowed it via ROLE_INHERITANCE)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T10:00:00.000Z'));
      prisma.designRequest.count.mockResolvedValue(0);

      await expect(
        service.getMyMonthlyApprovalRate(SALES_MANAGER),
      ).resolves.toBeDefined();
    });

    it('returns 3 months (oldest to newest, including the current one), each scoped to createdByUserId and with its own approval rate', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T10:00:00.000Z'));

      // 3 meses x (completedCount, approvedCount) = 6 llamadas a count(),
      // en el orden en que el service las dispara (Promise.all por mes).
      prisma.designRequest.count
        .mockResolvedValueOnce(5) // enero: completed
        .mockResolvedValueOnce(2) // enero: approved
        .mockResolvedValueOnce(0) // febrero: completed
        .mockResolvedValueOnce(0) // febrero: approved
        .mockResolvedValueOnce(4) // marzo: completed
        .mockResolvedValueOnce(4); // marzo: approved

      const result = await service.getMyMonthlyApprovalRate(SALES);

      expect(result).toEqual({
        months: [
          { month: '2026-01', completedCount: 5, approvedCount: 2, approvalRate: 40 },
          { month: '2026-02', completedCount: 0, approvedCount: 0, approvalRate: 0 },
          { month: '2026-03', completedCount: 4, approvedCount: 4, approvalRate: 100 },
        ],
      });

      // Todas las llamadas deben filtrar por el createdByUserId de quien pregunta.
      for (const [arg] of prisma.designRequest.count.mock.calls) {
        expect(arg.where.createdByUserId).toBe('sales-1');
      }
      // Las de "approved" (posiciones pares: 1, 3, 5) exigen approvedAt no nulo.
      expect(prisma.designRequest.count.mock.calls[1][0].where.approvedAt).toEqual({
        not: null,
      });
      expect(prisma.designRequest.count.mock.calls[3][0].where.approvedAt).toEqual({
        not: null,
      });
      expect(prisma.designRequest.count.mock.calls[5][0].where.approvedAt).toEqual({
        not: null,
      });

      jest.useRealTimers();
    });

    it('spans a year boundary correctly (ej. consultado en enero -> incluye noviembre/diciembre del año anterior)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-10T10:00:00.000Z'));
      prisma.designRequest.count.mockResolvedValue(0);

      const result = await service.getMyMonthlyApprovalRate(SALES);

      expect(result.months.map((m) => m.month)).toEqual([
        '2025-11',
        '2025-12',
        '2026-01',
      ]);

      jest.useRealTimers();
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
