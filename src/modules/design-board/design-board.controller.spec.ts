import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { of, Subject } from 'rxjs';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { DesignBoardController } from './design-board.controller';
import { DesignBoardService, AuthUser } from './design-board.service';

const SALES: AuthUser = { userId: 'sales-1', role: Role.SALES, accountId: 'account-1' };
const req = { user: SALES };

describe('DesignBoardController', () => {
  let controller: DesignBoardController;
  let service: {
    createRequest: jest.Mock;
    listRequests: jest.Mock;
    getRequestDetail: jest.Mock;
    assign: jest.Mock;
    move: jest.Mock;
    addComment: jest.Mock;
    approve: jest.Mock;
    forwardAttachment: jest.Mock;
    archive: jest.Mock;
    sendToModification: jest.Mock;
    pause: jest.Mock;
    resume: jest.Mock;
    getReportsSummary: jest.Mock;
  };
  let chatEvents: { stream: jest.Mock };

  beforeEach(async () => {
    service = {
      createRequest: jest.fn(),
      listRequests: jest.fn(),
      getRequestDetail: jest.fn(),
      assign: jest.fn(),
      move: jest.fn(),
      addComment: jest.fn(),
      approve: jest.fn(),
      forwardAttachment: jest.fn(),
      archive: jest.fn(),
      sendToModification: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      getReportsSummary: jest.fn(),
    };
    chatEvents = { stream: jest.fn().mockReturnValue(of()) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DesignBoardController],
      providers: [
        { provide: DesignBoardService, useValue: service },
        { provide: ChatEventsService, useValue: chatEvents },
      ],
    }).compile();

    controller = module.get<DesignBoardController>(DesignBoardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('createRequest delegates to the service with req.user and the body', () => {
    const dto = { leadId: 'lead-1', title: 'Boceto' } as any;
    service.createRequest.mockResolvedValue({ id: 'req-1' });

    const result = controller.createRequest(req, dto);

    expect(service.createRequest).toHaveBeenCalledWith(SALES, dto);
    expect(result).resolves.toEqual({ id: 'req-1' });
  });

  it('listRequests delegates to the service with req.user and the query', () => {
    const query = { columnId: 'col-new' } as any;
    service.listRequests.mockResolvedValue([]);

    const result = controller.listRequests(req, query);

    expect(service.listRequests).toHaveBeenCalledWith(SALES, query);
    expect(result).resolves.toEqual([]);
  });

  it('getRequestDetail delegates to the service with req.user and the id', () => {
    service.getRequestDetail.mockResolvedValue({ id: 'req-1' });

    const result = controller.getRequestDetail(req, 'req-1');

    expect(service.getRequestDetail).toHaveBeenCalledWith(SALES, 'req-1');
    expect(result).resolves.toEqual({ id: 'req-1' });
  });

  it('assign delegates to the service with req.user, id and the body', () => {
    const dto = { assignedUserId: 'designer-1' } as any;
    service.assign.mockResolvedValue({ id: 'req-1' });

    const result = controller.assign(req, 'req-1', dto);

    expect(service.assign).toHaveBeenCalledWith(SALES, 'req-1', dto);
    expect(result).resolves.toEqual({ id: 'req-1' });
  });

  it('move delegates to the service with req.user, id and the body', () => {
    const dto = { direction: 'FORWARD' } as any;
    service.move.mockResolvedValue({ id: 'req-1' });

    const result = controller.move(req, 'req-1', dto);

    expect(service.move).toHaveBeenCalledWith(SALES, 'req-1', dto);
    expect(result).resolves.toEqual({ id: 'req-1' });
  });

  it('addComment delegates to the service with req.user, id and the body', () => {
    const dto = { body: 'hola' } as any;
    service.addComment.mockResolvedValue({ id: 'c-1' });

    const result = controller.addComment(req, 'req-1', dto);

    expect(service.addComment).toHaveBeenCalledWith(SALES, 'req-1', dto);
    expect(result).resolves.toEqual({ id: 'c-1' });
  });

  it('approve delegates to the service with req.user and the id', () => {
    service.approve.mockResolvedValue({ id: 'req-1' });

    const result = controller.approve(req, 'req-1');

    expect(service.approve).toHaveBeenCalledWith(SALES, 'req-1');
    expect(result).resolves.toEqual({ id: 'req-1' });
  });

  it('forwardAttachment delegates to the service with req.user, the request id and the attachment id', () => {
    service.forwardAttachment.mockResolvedValue({ id: 'msg-1' });

    const result = controller.forwardAttachment(req, 'req-1', 'att-1');

    expect(service.forwardAttachment).toHaveBeenCalledWith(SALES, 'req-1', 'att-1');
    expect(result).resolves.toEqual({ id: 'msg-1' });
  });

  it('archive delegates to the service with req.user and the id', () => {
    service.archive.mockResolvedValue({ id: 'req-1' });

    const result = controller.archive(req, 'req-1');

    expect(service.archive).toHaveBeenCalledWith(SALES, 'req-1');
    expect(result).resolves.toEqual({ id: 'req-1' });
  });

  it('sendToModification delegates to the service with req.user and the id', () => {
    service.sendToModification.mockResolvedValue({ id: 'req-1', columnId: 'col-modification' });

    const result = controller.sendToModification(req, 'req-1');

    expect(service.sendToModification).toHaveBeenCalledWith(SALES, 'req-1');
    expect(result).resolves.toEqual({ id: 'req-1', columnId: 'col-modification' });
  });

  it('pause delegates to the service with req.user and the id', () => {
    service.pause.mockResolvedValue({ id: 'req-1', pausedAt: new Date() });

    const result = controller.pause(req, 'req-1');

    expect(service.pause).toHaveBeenCalledWith(SALES, 'req-1');
    expect(result).resolves.toEqual({ id: 'req-1', pausedAt: expect.any(Date) });
  });

  it('resume delegates to the service with req.user and the id', () => {
    service.resume.mockResolvedValue({ id: 'req-1', pausedAt: null });

    const result = controller.resume(req, 'req-1');

    expect(service.resume).toHaveBeenCalledWith(SALES, 'req-1');
    expect(result).resolves.toEqual({ id: 'req-1', pausedAt: null });
  });

  it('getReportsSummary delegates to the service with req.user and the query', () => {
    const query = { month: '2026-01' } as any;
    service.getReportsSummary.mockResolvedValue({ month: '2026-01' });

    const result = controller.getReportsSummary(req, query);

    expect(service.getReportsSummary).toHaveBeenCalledWith(SALES, query);
    expect(result).resolves.toEqual({ month: '2026-01' });
  });

  // ADR-004 Submódulo 11
  describe('streamEvents', () => {
    it('forwards design_request.* events to a SALES user, scoped to their own account', () => {
      const events$ = new Subject<any>();
      chatEvents.stream.mockReturnValue(events$.asObservable());
      const received: any[] = [];

      const sub = controller.streamEvents(req).subscribe((e) => received.push(e));
      events$.next({ id: 'e1', type: 'design_request.moved', accountId: 'account-1' });
      events$.next({ id: 'e2', type: 'design_request.moved', accountId: 'account-2' });
      events$.next({ id: 'e3', type: 'message.created', accountId: 'account-1' });
      sub.unsubscribe();

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(
        expect.objectContaining({ type: 'design_request.moved', id: 'e1' }),
      );
    });

    it('does not scope DESIGNER_MANAGER/ADMIN by accountId (the board is global)', () => {
      const events$ = new Subject<any>();
      chatEvents.stream.mockReturnValue(events$.asObservable());
      const managerReq = {
        user: { userId: 'manager-1', role: Role.DESIGNER_MANAGER, accountId: null },
      };
      const received: any[] = [];

      const sub = controller.streamEvents(managerReq).subscribe((e) => received.push(e));
      events$.next({ id: 'e1', type: 'design_request.moved', accountId: 'account-9' });
      sub.unsubscribe();

      expect(received).toHaveLength(1);
    });

    it('throws for a SALES user with no accountId', () => {
      chatEvents.stream.mockReturnValue(of());
      const badReq = { user: { userId: 'x', role: Role.SALES, accountId: null } };

      expect(() => controller.streamEvents(badReq)).toThrow();
    });
  });
});
