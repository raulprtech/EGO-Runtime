import express, { Router } from 'express';
import { authMiddleware } from '../auth';
import { MaterialStore, MaterialStoreError } from '../../services/material_store';

const router = Router();

function decodedHeader(value: string | undefined, label: string): string {
  if (!value) throw new MaterialStoreError('MATERIAL_HEADER_REQUIRED', 400, `${label} is required`);
  try { return decodeURIComponent(value); }
  catch { throw new MaterialStoreError('MATERIAL_HEADER_INVALID', 400, `${label} is invalid`); }
}

router.post('/', authMiddleware, express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      throw new MaterialStoreError('MATERIAL_BODY_INVALID', 400, 'Material body must be binary');
    }
    const result = await MaterialStore.stage({
      bytes: req.body,
      name: decodedHeader(req.header('X-Material-Name'), 'X-Material-Name'),
      mediaType: req.header('X-Material-Media-Type') ?? '',
      ownerRef: decodedHeader(req.header('X-Material-Owner'), 'X-Material-Owner'),
      idempotencyKey: req.header('Idempotency-Key') ?? '',
    });
    return res.status(result.disposition === 'staged' ? 201 : 200).json({
      protocol_version: 'ego.material-staging/v1',
      disposition: result.disposition,
      material: result.record,
      approval_granted: false,
      execution_performed: false,
    });
  } catch (error) {
    if (error instanceof MaterialStoreError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    return next(error);
  }
});

router.get('/:material_id', authMiddleware, async (req, res, next) => {
  try {
    return res.json(await MaterialStore.get(
      req.params.material_id,
      decodedHeader(req.header('X-Material-Owner'), 'X-Material-Owner'),
    ));
  } catch (error) {
    if (error instanceof MaterialStoreError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    return next(error);
  }
});

router.delete('/:material_id', authMiddleware, async (req, res, next) => {
  try {
    const material = await MaterialStore.release(
      req.params.material_id,
      decodedHeader(req.header('X-Material-Owner'), 'X-Material-Owner'),
    );
    return res.json({
      protocol_version: 'ego.material-release/v1', material,
      content_removed: true, execution_performed: false,
    });
  } catch (error) {
    if (error instanceof MaterialStoreError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    return next(error);
  }
});

export default router;
