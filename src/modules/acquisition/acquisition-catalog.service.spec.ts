import { BadRequestException } from '@nestjs/common';
import { AcquisitionCatalogService } from './acquisition-catalog.service';

describe('AcquisitionCatalogService (ADR-007, plantillas)', () => {
  const prisma = {
    investmentFamily: { findUnique: jest.fn() },
    acquisitionTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const touches = { backfillTemplate: jest.fn() };
  let service: AcquisitionCatalogService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AcquisitionCatalogService(prisma as any, touches as any);
  });

  it('listTemplates pone primero las pendientes de asignar', async () => {
    prisma.acquisitionTemplate.findMany.mockResolvedValue([
      { id: 'a', templateName: 'bolsas_es', familyId: 'f1', _count: { touches: 3 } },
      { id: 'b', templateName: 'nueva_es', familyId: null, _count: { touches: 1 } },
    ]);
    const list = await service.listTemplates();
    expect(list.map((t) => [t.templateName, t.touchCount])).toEqual([
      ['nueva_es', 1],
      ['bolsas_es', 3],
    ]);
  });

  it('crear una plantilla reconstruye su historico de envios de n8n', async () => {
    prisma.investmentFamily.findUnique.mockResolvedValue({ id: 'f1' });
    prisma.acquisitionTemplate.create.mockResolvedValue({ id: 't1', templateName: 'pizza_italia', familyId: 'f1' });
    touches.backfillTemplate.mockResolvedValue(12);

    const created = await service.createTemplate({ templateName: ' pizza_italia ', familyId: 'f1' });

    expect(prisma.acquisitionTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { templateName: 'pizza_italia', familyId: 'f1' } }),
    );
    expect(touches.backfillTemplate).toHaveBeenCalledWith('t1', 'pizza_italia');
    expect(created.backfilled).toBe(12);
  });

  it('rechaza nombres de plantilla no validos', async () => {
    await expect(service.createTemplate({ templateName: 'con espacios' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('no permite renombrar ni borrar una plantilla con leads registrados', async () => {
    prisma.acquisitionTemplate.findUnique.mockResolvedValue({
      id: 't1',
      templateName: 'cajas_pizza_es',
      _count: { touches: 5 },
    });

    await expect(service.updateTemplate('t1', { templateName: 'otra_es' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.deleteTemplate('t1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.acquisitionTemplate.delete).not.toHaveBeenCalled();
  });

  it('reasignar familia no relanza el historico (la familia se resuelve al consultar)', async () => {
    prisma.acquisitionTemplate.findUnique.mockResolvedValue({
      id: 't1',
      templateName: 'cajas_pizza_es',
      _count: { touches: 5 },
    });
    prisma.investmentFamily.findUnique.mockResolvedValue({ id: 'f2' });
    prisma.acquisitionTemplate.update.mockResolvedValue({ id: 't1', templateName: 'cajas_pizza_es', familyId: 'f2' });

    const updated = await service.updateTemplate('t1', { familyId: 'f2' });

    expect(prisma.acquisitionTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { templateName: undefined, familyId: 'f2', autoCreated: false } }),
    );
    expect(touches.backfillTemplate).not.toHaveBeenCalled();
    expect(updated.backfilled).toBe(0);
  });
});
