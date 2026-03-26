export type ExitClassification = 'success' | 'failure' | 'canceled' | 'invalid-usage';

export const EXIT_CODES: Record<ExitClassification, number> = {
  success: 0,
  failure: 1,
  canceled: 2,
  'invalid-usage': 3,
};

export function mapExitCode(classification: ExitClassification): number {
  return EXIT_CODES[classification];
}

