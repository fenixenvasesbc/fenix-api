# Fichaje y horas extra

Módulo `src/modules/time-tracking/`. Permite a los empleados fichar entrada/salida, calcula automáticamente horas extra pagables según el tipo de día (entre semana, sábado, domingo, festivo) y expone un resumen agregado por periodo para administración.

## Modelo

- `Employee`: `contractType` (`FIJO` | `POR_HORAS`), `isActive`, `hourlyRate` (opcional, `Decimal?`, agregado 09/nov/2026 -- ver "Precio por hora individual" más abajo).
- `TimeEntry`: un fichaje (`clockInAt`/`clockOutAt`). Al cerrarse (fichar salida o editar manualmente) se calculan y guardan `totalMinutes`, `wasCapped`, `payableHours`, `rateType`, `rateApplied`, `amount`.
- `TimeEntryRateType` (enum): `OVERTIME_WEEKDAY`, `OVERTIME_SATURDAY`, `OVERTIME_SUNDAY`, `OVERTIME_HOLIDAY`, `HOURLY`.
- `TimeTrackingRate`: tarifas vigentes (una fila, editable desde Configuración → Tarifas): `overtimeWeekdayRate`, `overtimeSaturdayRate`, `overtimeSundayRate`, `overtimeHolidayRate`, `hourlyRate`, `maxShiftEnabled`/`maxShiftMinutes`.
- `PublicHoliday`: calendario de festivos cargados manualmente (fecha, nombre, alcance nacional/autonómico). Si una fecha está cargada ahí, `resolveDayType()` la trata como `HOLIDAY` sin importar el día de la semana.

## Cálculo por fichaje (`TimeEntriesService.computeFinancials`)

1. Duración real del turno (sin capar, se guarda siempre para auditoría).
2. Si `maxShiftEnabled` y se supera `maxShiftMinutes` (reloj dejado corriendo), el pago se calcula solo hasta el tope (`wasCapped = true`).
3. Tipo de día (`resolveDayType`), por prioridad: **festivo** (si la fecha está en `PublicHoliday`) > domingo > sábado > entre semana.
4. Contrato `FIJO`:
   - Entre semana: solo se paga como extra lo que supere 8h (`payableHours` = horas por encima de la jornada regular).
   - Sábado / domingo / festivo: **toda la jornada** cuenta como extra desde la primera hora, a la tarifa de ese tipo de día.
5. Contrato `POR_HORAS`: todas las horas se pagan a `rateType = HOURLY`, sin importar el día, a `Employee.hourlyRate` si el empleado tiene uno propio configurado, o a la tarifa global `TimeTrackingRate.hourlyRate` en caso contrario (ver más abajo).
6. Fracciones ≥ 30 min redondean a la hora completa; menos de 30 min no se pagan.

## Precio por hora individual (09/nov/2026, pedido explícito del usuario)

Cada empleado puede tener su propio precio por hora (`Employee.hourlyRate`, `Decimal?`, opcional), configurable desde el mismo diálogo "Editar empleado" (pestaña Empleados) que ya existía para nombre/tipo de contrato/estado -- no se agregó un formulario aparte.

- Si el campo queda vacío (`null`), el empleado sigue usando la tarifa global `TimeTrackingRate.hourlyRate` (pestaña Tarifas) sin ningún cambio de comportamiento respecto a antes.
- Si se pone un valor, ese valor reemplaza a la tarifa global **solo para ese empleado**, exclusivamente en el paso 5 de `computeFinancials()` (contrato `POR_HORAS`).
- **No afecta a contrato `FIJO`**: las 4 tarifas de hora extra (`overtimeWeekdayRate`/`overtimeSaturdayRate`/`overtimeSundayRate`/`overtimeHolidayRate`) siguen siendo exclusivamente globales, no son configurables por empleado -- decisión explícita del usuario al definir el alcance de este cambio.
- `CreateEmployeeDto`/`UpdateEmployeeDto.hourlyRate` acepta `number | null | undefined`: omitir el campo en un `PATCH` deja el valor actual sin cambios; mandar `null` explícito lo borra (vuelve a la tarifa global). Mismo patrón de `@ValidateIf` + `@IsOptional()` ya usado en `UpdateLeadLabelDefinitionDto.alertThresholdDays`, para que un `null` explícito no se transforme en `0` vía `@Type(() => Number)`.
- `TimeEntriesService.clock()`/`updateEntry()` pasan `employee.hourlyRate` a `computeFinancials()`, que lo usa en vez de `rates.hourlyRate` cuando no es `null`.
- UI: la pestaña Empleados muestra una columna "Precio/h" con el valor configurado o "Global (Tarifas)" si no tiene override. El campo del diálogo incluye el helper text explicando que solo aplica a `POR_HORAS` y que vacío = tarifa global.
- No se tocó `TimeTrackingSummaryService` ni `TimeTrackingRatesService` -- el resumen agregado sigue funcionando igual, porque sigue leyendo `rateApplied`/`amount` ya calculados y guardados en cada `TimeEntry`, sin importar de dónde vino la tarifa.

## Resumen agregado (`TimeTrackingSummaryService`, pestaña "Resumen")

`GET /time-tracking/summary` agrupa los fichajes cerrados por periodo (día/semana/mes) y empleado, sumando horas e importe por `rateType` en columnas separadas: `overtimeWeekday*`, `overtimeSaturday*`, `overtimeSunday*`, `overtimeHoliday*`, `hourly*`, más `totalAmount` (suma de las cinco).

### Fix 30/oct/2026: domingo y festivo no se sumaban en el Resumen

El usuario reportó que un fichaje en un festivo autonómico cargado (9 de octubre, Día de la Comunitat Valenciana) aparecía en 0,00 € en las cuatro columnas del Resumen, pese a tener la tarifa de festivo configurada (15 €/h) y el festivo correctamente cargado en el calendario.

Causa: el fichaje individual sí se calculaba bien (`rateType = OVERTIME_HOLIDAY`, importe correcto guardado en `TimeEntry`), pero `TimeTrackingSummaryService.summarize()` solo tenía casos `if/else if` para `OVERTIME_WEEKDAY`, `OVERTIME_SATURDAY` y `HOURLY` — un fichaje con `rateType` `OVERTIME_SUNDAY` u `OVERTIME_HOLIDAY` no entraba en ningún bucket, así que no se sumaba a ninguna columna ni al total. El dato no se perdía (seguía visible en la lista de fichajes individuales de "Mis horas"/"Empleados", que sí usa las etiquetas `'Extra domingo'`/`'Extra festivo'`), pero el Resumen lo mostraba como si no existiera.

Fix: se agregaron los buckets `overtimeSundayHours/Amount` y `overtimeHolidayHours/Amount` a `SummaryRow`, sus ramas en el `if/else if` de agregación, y se incluyeron en el cálculo de `totalAmount`. En la SPA (`app/dashboard/fichaje/page.tsx`), la pestaña Resumen ganó dos columnas nuevas ("Extra domingo", "Extra festivo") y dos tarjetas de total correspondientes, junto a las que ya existían (Extra semana, Extra sábado, Horas sueltas, Total).

`tsc --noEmit -p tsconfig.json` corrió limpio tras el cambio. No se pudo correr Jest en este entorno (misma limitación documentada en el módulo de bocetos) — se verificó por revisión manual y balance de llaves.
