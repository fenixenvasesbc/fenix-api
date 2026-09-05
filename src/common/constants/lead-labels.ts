/**
 * Codigos de las labels "de sistema" que existian antes como el enum
 * LeadLabel. Ahora las labels son configurables (tabla LeadLabelDefinition,
 * por cuenta), pero estos 6 codigos siguen siendo especiales:
 *  - Se siembran automaticamente para cada Account (ver migracion
 *    20260904120000_lead_label_definitions) y no se pueden borrar
 *    (LeadLabelDefinition.isSystem = true).
 *  - REPETICIONES en particular sigue siendo usado tal cual (como string)
 *    por el sistema de envio automatico de WhatsApp
 *    (LeadRepetitionReminder / RepetitionReminderSchedulerService /
 *    RepetitionReminderDispatchService), que NO fue tocado por el cambio
 *    de enum a tabla. Ese codigo nunca debe renombrarse.
 */
export const SYSTEM_LABEL_CODES = {
  PRODUCCION: 'PRODUCCION',
  BOCETO_EN_PROCESO: 'BOCETO_EN_PROCESO',
  PENDIENTE_DE_PAGO: 'PENDIENTE_DE_PAGO',
  MUESTRAS: 'MUESTRAS',
  REPETICIONES: 'REPETICIONES',
  BOCETOS_ATRASADOS: 'BOCETOS_ATRASADOS',
} as const;

export type SystemLabelCode =
  (typeof SYSTEM_LABEL_CODES)[keyof typeof SYSTEM_LABEL_CODES];

export const SYSTEM_LABEL_SEED: Array<{
  code: SystemLabelCode;
  name: string;
  alertThresholdDays: number | null;
  sortOrder: number;
}> = [
  {
    code: SYSTEM_LABEL_CODES.PRODUCCION,
    name: 'Produccion',
    alertThresholdDays: 14,
    sortOrder: 1,
  },
  {
    code: SYSTEM_LABEL_CODES.BOCETO_EN_PROCESO,
    name: 'Boceto en proceso',
    alertThresholdDays: 4,
    sortOrder: 2,
  },
  {
    code: SYSTEM_LABEL_CODES.PENDIENTE_DE_PAGO,
    name: 'Pendiente de pago',
    alertThresholdDays: 7,
    sortOrder: 3,
  },
  {
    code: SYSTEM_LABEL_CODES.MUESTRAS,
    name: 'Muestras',
    alertThresholdDays: 7,
    sortOrder: 4,
  },
  {
    code: SYSTEM_LABEL_CODES.REPETICIONES,
    name: 'Repeticiones',
    alertThresholdDays: null,
    sortOrder: 5,
  },
  {
    code: SYSTEM_LABEL_CODES.BOCETOS_ATRASADOS,
    name: 'Boceto atrasado',
    alertThresholdDays: 2,
    sortOrder: 6,
  },
];
