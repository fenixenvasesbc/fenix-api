// Arma los "components" que espera Meta/YCloud (HEADER/BODY/FOOTER/BUTTONS)
// a partir de los campos sueltos que llenan desde la SPA. Compartido entre
// el envio de plantillas por cuenta (outbound) y la gestion global de
// plantillas (global-templates), asi ambos generan exactamente el mismo
// payload para el mismo formulario.
export type TemplateButtonInput = {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string | null;
  phoneNumber?: string | null;
};

export type BuildTemplateComponentsInput = {
  headerText?: string | null;
  headerFormat?: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null;
  headerMediaUrl?: string | null;
  bodyText: string;
  bodyExamples?: string[] | null;
  footerText?: string | null;
  buttons?: TemplateButtonInput[] | null;
};

export function buildWhatsappTemplateComponents(
  input: BuildTemplateComponentsInput,
): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];

  if (input.headerFormat && input.headerMediaUrl) {
    components.push({
      type: 'HEADER',
      format: input.headerFormat,
      example: { header_url: [input.headerMediaUrl] },
    });
  } else if (input.headerText) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: input.headerText,
    });
  }

  components.push({
    type: 'BODY',
    text: input.bodyText,
    ...(input.bodyExamples?.length
      ? { example: { body_text: [input.bodyExamples] } }
      : {}),
  });

  if (input.footerText) {
    components.push({ type: 'FOOTER', text: input.footerText });
  }

  if (input.buttons?.length) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((button) => ({
        type: button.type,
        text: button.text,
        ...(button.type === 'URL' && button.url ? { url: button.url } : {}),
        ...(button.type === 'PHONE_NUMBER' && button.phoneNumber
          ? { phone_number: button.phoneNumber }
          : {}),
      })),
    });
  }

  return components;
}
