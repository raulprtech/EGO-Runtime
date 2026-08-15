import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createHermesDecisionBinding,
  expireHermesDecisionBinding,
  fetchHermesDecisionMessages,
  HermesDecisionAdapterError,
  inspectHermesDecisionMessages,
  probeHermesDecisionCompatibility,
  readHermesDecisionBindingFile,
  scanHermesDecisionBinding,
  superviseHermesDecisionBinding,
  writeHermesDecisionBindingFile,
  type HermesDecisionAdapterConfig,
  type HermesConnectionConfig,
} from '../src/integrations/hermes_decision_adapter';

type Options = Record<string, string>;

function options(values: string[]): Options {
  const result: Options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new HermesDecisionAdapterError('ARGUMENTS_INVALID', 'Arguments must use --name value pairs');
    }
    const key = name.slice(2);
    if (result[key] !== undefined) {
      throw new HermesDecisionAdapterError('ARGUMENTS_INVALID', `Argument --${key} repeated`);
    }
    result[key] = value;
  }
  return result;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new HermesDecisionAdapterError('ARGUMENTS_INVALID', `${label} is required`);
  return value;
}

function hermesConfig(): HermesConnectionConfig {
  return {
    hermesBaseUrl: required(process.env.HERMES_CHAT_URL, 'HERMES_CHAT_URL'),
    hermesApiKey: required(process.env.HERMES_CHAT_API_KEY, 'HERMES_CHAT_API_KEY'),
    hermesProfile: process.env.HERMES_PROFILE?.trim() || 'default',
  };
}

function config(): HermesDecisionAdapterConfig {
  return {
    ...hermesConfig(),
    egoBaseUrl: required(process.env.EGO_RUNTIME_URL, 'EGO_RUNTIME_URL'),
    egoRuntimeToken: required(process.env.EGO_RUNTIME_TOKEN, 'EGO_RUNTIME_TOKEN'),
    humanDecisionToken: required(
      process.env.NIGMA_HUMAN_DECISION_TOKEN, 'NIGMA_HUMAN_DECISION_TOKEN',
    ),
  };
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(path.resolve(file), 'utf8')); } catch {
    throw new HermesDecisionAdapterError('FILE_INVALID', `Could not read valid JSON from ${file}`);
  }
}

async function bind(input: Options): Promise<Record<string, unknown>> {
  const sessionRef = required(input['session-ref'], '--session-ref');
  const bindingFile = required(input.binding, '--binding');
  if (await fs.stat(path.resolve(bindingFile)).then(() => true, () => false)) {
    throw new HermesDecisionAdapterError(
      'BINDING_ALREADY_EXISTS', 'Refusing to overwrite an existing binding',
    );
  }
  const adapterConfig = config();
  const compatibility = await probeHermesDecisionCompatibility(adapterConfig);
  const messages = await fetchHermesDecisionMessages(adapterConfig, sessionRef);
  const binding = createHermesDecisionBinding(
    await readJson(required(input.preparation, '--preparation')),
    sessionRef,
    messages,
    required(input.approver, '--approver'),
    required(input['expires-at'], '--expires-at'),
    new Date(),
    adapterConfig.hermesProfile,
    compatibility.digest,
  );
  await writeHermesDecisionBindingFile(bindingFile, binding);
  return {
    protocol_version: 'nigma.hermes-decision-adapter-output/v1',
    outcome: 'binding_created',
    binding_digest: binding.binding_digest,
    baseline_message_count: binding.baseline_message_ref_sha256.length,
    state: binding.state,
    hermes_contract_digest: compatibility.digest,
  };
}

async function scan(input: Options): Promise<Record<string, unknown>> {
  const sessionRef = required(input['session-ref'], '--session-ref');
  const bindingFile = required(input.binding, '--binding');
  const binding = await readHermesDecisionBindingFile(bindingFile);
  if (binding.state === 'recorded') {
    return {
      protocol_version: 'nigma.hermes-decision-adapter-output/v1',
      outcome: 'already_recorded',
      binding_digest: binding.binding_digest,
      approval_id: binding.decision?.approval_id,
      conversation_record_digest: binding.decision?.conversation_record_digest,
    };
  }
  if (binding.state === 'expired'
      || (binding.protocol_version === 'nigma.hermes-conversation-binding/v2'
        && Date.parse(binding.approval_expires_at) < Date.now() + 60_000)) {
    const expired = binding.state === 'expired'
      ? binding : expireHermesDecisionBinding(binding);
    if (expired !== binding) await writeHermesDecisionBindingFile(bindingFile, expired);
    return {
      protocol_version: 'nigma.hermes-decision-adapter-output/v1',
      outcome: 'approval_window_closed',
      binding_digest: expired.binding_digest,
      state: expired.state,
      execution_performed: false,
    };
  }
  const messages = await fetchHermesDecisionMessages(config(), sessionRef);
  const result = await scanHermesDecisionBinding(binding, sessionRef, messages, config());
  if (result.outcome === 'approval_recorded') {
    await writeHermesDecisionBindingFile(bindingFile, result.binding);
  }
  return {
    protocol_version: 'nigma.hermes-decision-adapter-output/v1',
    outcome: result.outcome,
    binding_digest: result.binding.binding_digest,
    approval_id: result.binding.decision?.approval_id,
    conversation_record_digest: result.binding.decision?.conversation_record_digest,
    execution_performed: false,
  };
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HermesDecisionAdapterError(
      'ARGUMENTS_INVALID', `Expected an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

async function doctor(input: Options): Promise<Record<string, unknown>> {
  const adapterConfig = hermesConfig();
  const compatibility = await probeHermesDecisionCompatibility(adapterConfig);
  const sessionRef = input['session-ref'];
  const messages = sessionRef
    ? inspectHermesDecisionMessages(
      await fetchHermesDecisionMessages(adapterConfig, sessionRef),
    ) : undefined;
  return {
    protocol_version: 'nigma.hermes-decision-adapter-output/v1',
    outcome: 'compatible',
    platform: compatibility.platform,
    profile_sha256: compatibility.profile_sha256,
    hermes_contract_digest: compatibility.digest,
    session_messages_verified: Boolean(messages),
    message_count: messages?.message_count,
  };
}

async function watch(input: Options): Promise<Record<string, unknown>> {
  const sessionRef = required(input['session-ref'], '--session-ref');
  const bindingFile = required(input.binding, '--binding');
  const result = await superviseHermesDecisionBinding({
    binding: await readHermesDecisionBindingFile(bindingFile),
    sessionRef,
    config: config(),
    pollMs: boundedInteger(input['poll-ms'], 2_000, 250, 30_000),
    maxTransientErrors: boundedInteger(input['max-transient-errors'], 5, 0, 100),
    onBinding: binding => writeHermesDecisionBindingFile(bindingFile, binding),
  });
  return {
    protocol_version: 'nigma.hermes-decision-adapter-output/v1',
    outcome: result.outcome,
    binding_digest: result.binding.binding_digest,
    state: result.binding.state,
    approval_id: result.binding.decision?.approval_id,
    conversation_record_digest: result.binding.decision?.conversation_record_digest,
    scans: result.scans,
    transient_errors: result.transient_errors,
    execution_performed: false,
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const input = options(rest);
  const result = command === 'doctor' ? await doctor(input)
    : command === 'bind' ? await bind(input)
    : command === 'scan' ? await scan(input)
      : command === 'watch' ? await watch(input)
        : (() => { throw new HermesDecisionAdapterError('ARGUMENTS_INVALID', 'Use doctor, bind, scan or watch'); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const code = error instanceof HermesDecisionAdapterError ? error.code : 'ADAPTER_FAILED';
  const message = error instanceof Error ? error.message : 'Adapter failed';
  process.stderr.write(`${JSON.stringify({ error: code, message })}\n`);
  process.exitCode = 1;
});
