import { Router } from 'express';
import { ZodError } from 'zod';
import { authMiddleware, humanDecisionMiddleware } from '../auth';
import { unsupportedCapabilities } from '../../runtime/manifest';
import { approvalRequestDigest } from '../../runtime/integrity';
import {
  createNigmaRuntimeReceipt,
  getNigmaAdapterPolicy,
  NigmaHandoffError,
  NigmaInvocationSubmissionSchema,
  validateAndMapNigmaSubmission,
} from '../../runtime/nigma_handoff';
import {
  NigmaEducationalPreparationRequestSchema,
  NigmaPresentationLocaleSchema,
  NigmaHostError,
  NigmaHostRunRequestSchema,
  NigmaTrustedConversationDecisionRequestSchema,
  NigmaTrustedHumanApprovalRequestSchema,
  getNigmaHostRunEvents,
  getNigmaHostRunRecord,
  prepareNigmaEducationalTask,
  prepareNigmaHostFallback,
  renderNigmaHostPreparationSse,
  recordTrustedNigmaConversationDecision,
  recordTrustedNigmaHumanApproval,
  runApprovedNigmaPlan,
} from '../../runtime/nigma_host';
import { getRuntimeRepository } from '../../services/runtime_repository';
import { TaskQueue } from '../../services/task_queue';
import {
  listNigmaDecisionEvents,
  recordNigmaConversationDecisionEvent,
} from '../../runtime/nigma_decision_events';

const router = Router();

router.post('/educational-tasks/prepare', authMiddleware, async (req, res, next) => {
  try {
    const request = NigmaEducationalPreparationRequestSchema.parse(req.body);
    const result = await prepareNigmaEducationalTask(
      request, req.header('Idempotency-Key') ?? '',
    );
    const acceptsSse = (req.header('Accept') ?? '').split(',')
      .some(value => value.trim().split(';', 1)[0].toLowerCase() === 'text/event-stream');
    if (acceptsSse) {
      const rendered = renderNigmaHostPreparationSse(result);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Nigma-Projection-Digest': result.interface_projection?.digest ?? '',
      });
      return res.send(rendered);
    }
    return res.json(result);
  } catch (error) {
    if (error instanceof NigmaHostError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) return next(error);
    return next(error);
  }
});

router.post(
  '/human-approvals',
  authMiddleware,
  humanDecisionMiddleware,
  async (req, res, next) => {
    try {
      const submission = NigmaTrustedHumanApprovalRequestSchema.parse(req.body);
      return res.json(await recordTrustedNigmaHumanApproval(
        submission, req.header('Idempotency-Key') ?? '',
      ));
    } catch (error) {
      if (error instanceof NigmaHostError) {
        return res.status(error.status).json({ error: error.code, message: error.message });
      }
      if (error instanceof ZodError) return next(error);
      return next(error);
    }
  },
);

router.post(
  '/conversation-decisions',
  authMiddleware,
  humanDecisionMiddleware,
  async (req, res, next) => {
    try {
      const submission = NigmaTrustedConversationDecisionRequestSchema.parse(req.body);
      const result = await recordTrustedNigmaConversationDecision(
        submission, req.header('Idempotency-Key') ?? '',
      );
      await recordNigmaConversationDecisionEvent(
        result, req.header('X-Interface-Profile') ?? 'default',
      );
      return res.json(result);
    } catch (error) {
      if (error instanceof NigmaHostError) {
        return res.status(error.status).json({ error: error.code, message: error.message });
      }
      if (error instanceof ZodError) return next(error);
      return next(error);
    }
  },
);

router.get('/decision-events', authMiddleware, async (req, res, next) => {
  try {
    const profile = typeof req.query.profile === 'string' ? req.query.profile : 'default';
    const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : '20';
    const limit = Number(rawLimit);
    if (!/^\d{1,3}$/.test(rawLimit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'NIGMA_DECISION_EVENT_LIMIT_INVALID' });
    }
    return res.json({ events: await listNigmaDecisionEvents(profile, limit) });
  } catch (error) {
    if (error instanceof ZodError) return next(error);
    return next(error);
  }
});

router.post('/host-runs', authMiddleware, async (req, res, next) => {
  try {
    const request = NigmaHostRunRequestSchema.parse(req.body);
    const result = await runApprovedNigmaPlan(request, req.header('Idempotency-Key') ?? '');
    return res.json(result);
  } catch (error) {
    if (error instanceof NigmaHostError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) return next(error);
    return next(error);
  }
});

router.get('/host-runs/:host_run_id', authMiddleware, async (req, res, next) => {
  try {
    return res.json(await getNigmaHostRunRecord(req.params.host_run_id));
  } catch (error) {
    if (error instanceof NigmaHostError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    return next(error);
  }
});

router.get('/host-runs/:host_run_id/events', authMiddleware, async (req, res, next) => {
  try {
    const raw = req.query.after ?? '0';
    if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw)) {
      throw new NigmaHostError(
        'NIGMA_HOST_EVENT_CURSOR_INVALID', 400, 'Event cursor is invalid',
      );
    }
    return res.json(await getNigmaHostRunEvents(req.params.host_run_id, Number(raw)));
  } catch (error) {
    if (error instanceof NigmaHostError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    return next(error);
  }
});

router.post('/host-runs/:host_run_id/fallbacks', authMiddleware, async (req, res, next) => {
  try {
    if (req.body && Object.keys(req.body as Record<string, unknown>).length) {
      throw new NigmaHostError(
        'NIGMA_HOST_FALLBACK_BODY_FORBIDDEN', 400,
        'Fallback evidence is derived from the sealed host record',
      );
    }
    return res.json(await prepareNigmaHostFallback(
      req.params.host_run_id,
      req.header('Idempotency-Key') ?? '',
      NigmaPresentationLocaleSchema.parse(req.header('X-Presentation-Locale') ?? 'es-MX'),
    ));
  } catch (error) {
    if (error instanceof NigmaHostError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    return next(error);
  }
});

router.post('/invocations', authMiddleware, async (req, res, next) => {
  try {
    const submission = NigmaInvocationSubmissionSchema.parse(req.body);
    const policy = await getNigmaAdapterPolicy();
    const input = validateAndMapNigmaSubmission(submission, policy);
    const unsupported = unsupportedCapabilities(input.capabilities);
    if (unsupported.length) {
      throw new NigmaHandoffError(
        'NIGMA_MAPPED_CAPABILITIES_UNSUPPORTED',
        422,
        `Mapped runtime capabilities are unsupported: ${unsupported.join(', ')}`,
      );
    }
    const repository = getRuntimeRepository();
    const result = await repository.submit(input, approvalRequestDigest(input));
    if (result.shouldDispatch) {
      try {
        await TaskQueue.dispatch(input);
        await repository.recordDispatch(input.request_id, 'dispatched');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Dispatch failed';
        await repository.recordDispatch(input.request_id, 'failed', message);
        throw error;
      }
    }
    res.status(202).json({
      invocation_id: submission.invocation.id,
      invocation_digest: submission.invocation.digest,
      runtime_run_id: input.request_id,
      status: result.created
        ? 'accepted'
        : result.shouldDispatch ? 'redispatched' : 'already_accepted',
    });
  } catch (error) {
    if (error instanceof NigmaHandoffError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof ZodError) return next(error);
    next(error);
  }
});

router.get('/:invocation_id/receipt', authMiddleware, async (req, res, next) => {
  try {
    await getNigmaAdapterPolicy();
    const job = await getRuntimeRepository().getJob(req.params.invocation_id);
    if (!job) return res.status(404).json({ error: 'NIGMA_JOB_NOT_FOUND' });
    return res.json(createNigmaRuntimeReceipt(job));
  } catch (error) {
    if (error instanceof NigmaHandoffError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    next(error);
  }
});

export default router;
