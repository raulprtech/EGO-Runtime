export type SpeechAudioFormat = 'wav' | 'pcm';

export interface SpeechSynthesisRequest {
  text: string;
  voice?: string;
  language?: string;
  style?: string;
  format: SpeechAudioFormat;
  abortSignal?: AbortSignal;
}

export interface SpeechSynthesisResult {
  audio: Uint8Array;
  mimeType: 'audio/wav' | 'audio/L16';
  sampleRate: number;
  channels: number;
  durationMs?: number;
}

export interface SpeechSynthesisProvider {
  readonly id: string;
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}

let override: SpeechSynthesisProvider | undefined;

export function setSpeechSynthesisProvider(provider?: SpeechSynthesisProvider): void {
  override = provider;
}

export async function getSpeechSynthesisProvider(): Promise<SpeechSynthesisProvider> {
  if (override) return override;
  const provider = process.env.SPEECH_SYNTHESIS_PROVIDER ?? 'gemini';
  if (provider === 'gemini') {
    const { GeminiSpeechSynthesisProvider } = await import('../providers/gemini_speech_synthesis_provider');
    return new GeminiSpeechSynthesisProvider();
  }
  throw new Error(`Unsupported SPEECH_SYNTHESIS_PROVIDER: ${provider}`);
}
