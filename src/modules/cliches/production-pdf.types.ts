import { ClicheCategory } from '@prisma/client';

export type ParsedProductionEntry = {
  machineNumber: number | null;
  machineLabel: string;
  date: string;
  dayOfWeek: string;
  clientName: string;
};

export type ClicheLocationMatch = {
  id: string;
  name: string;
  category: ClicheCategory;
  year: number;
  letter: string;
};

export type ProductionPlanEntry = ParsedProductionEntry & {
  matches: ClicheLocationMatch[];
};
