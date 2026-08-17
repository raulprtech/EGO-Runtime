import { describe, expect, it } from 'vitest';
import {
  isExplicitEducationalConfirmation,
  NigmaAuthenticatedEducationalConfirmationRequestSchema,
  NigmaAuthenticatedEducationalRequestExecutionSchema,
} from '../src/runtime/nigma_host';

describe('authenticated educational confirmation', () => {
  it('accepts only standalone affirmative decisions', () => {
    for (const value of ['Sí', 'si.', 'Yes', 'Confirmo', 'Adelante!']) {
      expect(isExplicitEducationalConfirmation(value)).toBe(true);
    }
    for (const value of ['No', 'Sí, pero cambia el plan', 'Ejecuta otra cosa', '']) {
      expect(isExplicitEducationalConfirmation(value)).toBe(false);
    }
  });

  it('accepts an exact authenticated educational request only from a user turn', () => {
    const request = {
      protocol_version: 'nigma.authenticated-educational-request-execution/v1',
      host_preparation_id: 'host-preparation-' + '1'.repeat(32),
      interface_projection_id: 'host-preparation-interface-' + '2'.repeat(16),
      interface_projection_digest: '3'.repeat(64),
      turn: {
        role: 'user', origin: 'externally_authenticated_human',
        conversation_ref: 'session-1', message_ref: 'message-1',
        observed_at: '2026-08-17T20:00:00.000Z',
        content: 'Crea un plan de aprendizaje sobre este documento',
      },
      approver: 'aria-local-user',
    };
    expect(NigmaAuthenticatedEducationalRequestExecutionSchema.parse(request)).toEqual(request);
    expect(() => NigmaAuthenticatedEducationalRequestExecutionSchema.parse({
      ...request, turn: { ...request.turn, role: 'assistant' },
    })).toThrow();
  });

  it('requires an externally authenticated user turn and sealed links', () => {
    const request = {
      protocol_version: 'nigma.authenticated-educational-confirmation/v1',
      host_preparation_id: 'host-preparation-' + '1'.repeat(32),
      interface_projection_id: 'host-preparation-interface-' + '2'.repeat(16),
      interface_projection_digest: '3'.repeat(64),
      turn: { role: 'user', origin: 'externally_authenticated_human', conversation_ref: 'session-1', message_ref: 'message-1', observed_at: '2026-08-17T20:00:00.000Z', content: 'Sí' },
      approver: 'aria-local-user',
    };
    expect(NigmaAuthenticatedEducationalConfirmationRequestSchema.parse(request)).toEqual(request);
    expect(() => NigmaAuthenticatedEducationalConfirmationRequestSchema.parse({ ...request, turn: { ...request.turn, role: 'assistant' } })).toThrow();
  });
});
