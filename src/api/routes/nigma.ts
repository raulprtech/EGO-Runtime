import { Router } from 'express';
import { ZodError } from 'zod';
import { authMiddleware } from '../auth';
import { unsupportedCapabilities } from '../../runtime/manifest';
import { approvalRequestDigest } from '../../runtime/integrity';
import {
  createNigmaRuntimeReceipt,
  getNigmaAdapterPolicy,
  NigmaHandoffError,
  NigmaInvocationSubmissionSchema,
  validateAndMapNigmaSubmission,
} from '../../runtime/nigma_handoff';
import { NigmaHostError, NigmaHostRunRequestSchema, runApprovedNigmaPlan }
  from '../../runtime/nigma_host';
import { getRuntimeRepository } from '../../services/runtime_repository';
import { TaskQueue } from '../../services/task_queue';

const router = Router();

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
