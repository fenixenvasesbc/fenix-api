export interface BusinessWindow {
  businessWindowKey: string;
  start: Date;
  end: Date;
}

export function resolveReengagementWindow(now: Date): BusinessWindow | null {
  const current = new Date(now);
  const day = current.getDay(); // 0 domingo, 1 lunes, 2 martes...

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  const addDays = (d: Date, days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  };

  // lunes, sábado, domingo => no procesa
  if (day === 1 || day === 6 || day === 0) {
    return null;
  }

  let start: Date;
  let end: Date;

  // martes => lunes + martes de la semana anterior
  if (day === 2) {
    const mondayLastWeek = addDays(current, -8);
    const tuesdayLastWeek = addDays(current, -7);
    start = startOfDay(mondayLastWeek);
    end = endOfDay(tuesdayLastWeek);
  } else {
    const sameDayLastWeek = addDays(current, -7);
    start = startOfDay(sameDayLastWeek);
    end = endOfDay(sameDayLastWeek);
  }

  const yyyy = current.getFullYear();
  const mm = String(current.getMonth() + 1).padStart(2, '0');
  const dd = String(current.getDate()).padStart(2, '0');

  return {
    businessWindowKey: `WEEK1_REENGAGEMENT:${yyyy}-${mm}-${dd}`,
    start,
    end,
  };
}
