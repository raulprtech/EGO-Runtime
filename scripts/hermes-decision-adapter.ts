import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createHermesDecisionBinding,
  fetchHermesDecisionMessages,
  HermesDecisionAdapterError,
  readHermesDecisionBindingFile,
  scanHermesDecisionBinding,
  writeHermesDecisionBindingFile,
  type HermesDecisionAdapterConfig,
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

function config(): HermesDecisionAdapterConfig {
  return {
    hermesBaseUrl: required(process.env.HERMES_CHAT_URL, 'HERMES_CHAT_URL'),
    hermesApiKey: required(process.env.HERMES_CHAT_API_KEY, 'HERMES_CHAT_API_KEY'),
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
  const messages = await fetchHermesDecisionMessages(config(), sessionRef);
  const binding = createHermesDecisionBinding(
    await readJson(required(input.preparation, '--preparation')),
    sessionRef,
    messages,
    required(input.approver, '--approver'),
    required(input['expires-at'], '--expires-at'),
  );
  await writeHermesDecisionBindingFile(bindingFile, binding);
  return {
    protocol_version: 'nigma.hermes-decision-adapter-output/v1',
    outcome: 'binding_created',
    binding_digest: binding.binding_digest,
    baseline_message_count: binding.baseline_message_ref_sha256.length,
    state: binding.state,
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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const input = options(rest);
  const result = command === 'bind' ? await bind(input)
    : command === 'scan' ? await scan(input)
      : (() => { throw new HermesDecisionAdapterError('ARGUMENTS_INVALID', 'Use bind or scan'); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const code = error instanceof HermesDecisionAdapterError ? error.code : 'ADAPTER_FAILED';
  const message = error instanceof Error ? error.message : 'Adapter failed';
  process.stderr.write(`${JSON.stringify({ error: code, message })}\n`);
  process.exitCode = 1;
});
