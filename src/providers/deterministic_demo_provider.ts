import { z } from 'zod';
import { ModelProvider, StructuredGenerationRequest } from '../runtime/model_provider';

const stopWords = new Set([
  'about', 'against', 'answer', 'como', 'con', 'del', 'desde', 'explain', 'from',
  'into', 'para', 'por', 'que', 'source', 'sobre', 'the', 'this', 'una', 'using',
  'forma', 'propias', 'palabras', 'propios', 'words',
]);

const conceptAliases: Record<string, string[][]> = {
  nigma: [
    ['orquestador'],
    ['modulo', 'decide', 'camino', 'ejecutar', 'tarea'],
    ['capa', 'selecciona', 'herramientas', 'datos'],
  ],
  setup: [['configuracion'], ['instalacion'], ['entorno']],
  deterministic: [['determinista'], ['reproducible'], ['reglas']],
  runtime: [['runtime'], ['ejecutor'], ['entorno', 'ejecucion']],
  selection: [['seleccion'], ['elegir'], ['elige'], ['selecciona'], ['decide'], ['escoge']],
};

type DeterministicAssessmentReason =
  'mastered' | 'partial_match' | 'uncertain' | 'insufficient_evidence';

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function section(prompt: string, start: string, end?: string): string {
  const offset = prompt.indexOf(start);
  if (offset < 0) return '';
  const value = prompt.slice(offset + start.length);
  if (!end) return value.trim();
  const boundary = value.indexOf(end);
  return (boundary < 0 ? value : value.slice(0, boundary)).trim();
}

function conceptsFromMaterial(material: string): string[] {
  const headings = [...material.matchAll(/^#{1,4}\s+(.+)$/gm)]
    .map(match => match[1].trim())
    .filter(value => !value.toLowerCase().startsWith('source '));
  if (headings.length) return unique(headings).slice(0, 5);
  const sentences = material.replace(/^## Source[^\n]*$/gm, '').split(/[.!?\n]+/)
    .map(value => value.trim()).filter(value => value.length >= 8);
  return unique(sentences).slice(0, 3).map(value => value.slice(0, 100));
}

function documentAnalysis(prompt: string) {
  const ids = section(prompt, 'Allowed artifact IDs:', '\n').split(',').map(value => value.trim()).filter(Boolean);
  const concepts = conceptsFromMaterial(section(prompt, 'Material:'));
  const labels = concepts.length ? concepts : ['Main source idea'];
  const nodes = labels.map((label, index) => ({
    id: `concept_${index + 1}`,
    label,
    type: index === 0 ? 'foundation' : 'concept',
    source_artifact_ids: ids,
  }));
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      source: nodes[index].id,
      target: node.id,
      relationship: 'precedes',
    })),
  };
}

function learningPlan(prompt: string) {
  const objective = section(prompt, 'Learning objective:', '\n\nExtracted source material:');
  const labels = conceptsFromMaterial(section(prompt, 'Extracted source material:'));
  const concepts = labels.length ? labels : ['Main source idea'];
  return {
    learning_objective: objective || 'Understand the referenced material',
    sub_objectives: concepts.map(label => `Explain ${label} without consulting the source`),
    required_concepts: concepts,
    dependencies: concepts.slice(1).map((label, index) => `${concepts[index]} -> ${label}`),
    estimated_difficulty: concepts.length > 4 ? 'intermediate' : 'introductory',
    study_sessions: concepts.slice(0, 3).map((label, index) => ({
      id: `session_${index + 1}`,
      topic: label,
      duration_minutes: 25,
      technique: index === 0 ? 'feynman' : index === 1 ? 'flashcards' : 'quiz',
      activities: [`Review the source section for ${label}`, `Explain ${label} in your own words`],
      completion_criteria: [`Produce one source-grounded explanation of ${label}`],
    })),
    review_cadence_days: [1, 3, 7],
    mastery_criteria: ['Explain every selected concept without notes', 'Reach at least 80% on retrieval questions'],
    deliverables: ['Feynman explanation', 'Completed retrieval practice'],
  };
}

function practiceSet(prompt: string) {
  const graph = JSON.parse(section(prompt, 'Concept graph:')) as {
    nodes: Array<{ id: string; label: string; source_artifact_ids: string[] }>;
  };
  const nodes = graph.nodes.length ? graph.nodes : [{
    id: 'concept_1', label: 'Main source idea', source_artifact_ids: ['source_1'],
  }];
  const selected = [0, 1, 2].map(index => nodes[index % nodes.length]);
  return {
    session: {
      title: `Retrieval practice: ${nodes[0].label}`,
      focus_minutes: 25,
      feynman_prompt: `Explain ${nodes[0].label} in simple terms and cite the supplied material.`,
      completion_criteria: ['Complete all three retrieval questions'],
    },
    flashcards: selected.map((node, index) => ({
      id: `flashcard_${index + 1}`,
      concept_id: node.id,
      front: `What is the role of ${node.label}?`,
      back: `Review and explain ${node.label} using the referenced source.`,
      source_artifact_ids: node.source_artifact_ids,
    })),
    quiz: selected.map((node, index) => ({
      id: `question_${index + 1}`,
      concept_id: node.id,
      prompt: `Explain ${node.label} in your own words.`,
      answer_key: node.label,
      rubric: [`Mentions the central idea of ${node.label}`, 'Uses information from the source'],
      source_artifact_ids: node.source_artifact_ids,
    })),
  };
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(/\s+/).filter(token => token.length > 2 && !stopWords.has(token)));
}

function isUncertain(value: string): boolean {
  const normalized = value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return [
    'no se', 'no estoy seguro', 'no estoy segura', 'no recuerdo', 'no lo recuerdo',
    'i do not know', 'i don t know', 'dont know', 'not sure', 'i am not sure',
  ].includes(normalized);
}

function matchesExpected(expected: string, actual: Set<string>): boolean {
  if (actual.has(expected)) return true;
  return (conceptAliases[expected] ?? []).some(alias => {
    const hits = alias.filter(token => actual.has(token)).length;
    const required = alias.length <= 2 ? alias.length : Math.ceil(alias.length * 0.6);
    return hits >= required;
  });
}

function feedbackFor(reason: DeterministicAssessmentReason, spanish: boolean): string {
  const messages = spanish ? {
    mastered: 'La respuesta incluye el concepto esperado o una equivalencia calibrada.',
    partial_match: 'La respuesta recupera parte del concepto; revisa los elementos faltantes.',
    uncertain: 'La respuesta expresa incertidumbre; vuelve a la fuente antes de intentarlo de nuevo.',
    insufficient_evidence: 'La respuesta no aporta evidencia suficiente del concepto esperado.',
  } : {
    mastered: 'The response includes the expected concept or a calibrated equivalent.',
    partial_match: 'The response retrieves part of the concept; review the missing elements.',
    uncertain: 'The response expresses uncertainty; revisit the source before trying again.',
    insufficient_evidence: 'The response does not provide enough evidence of the expected concept.',
  };
  return messages[reason];
}

function assessment(prompt: string) {
  const requestedLanguage = section(prompt, 'Requested language:', '\nPractice set:').trim();
  const spanish = requestedLanguage.toLowerCase().startsWith('es');
  const practice = JSON.parse(section(prompt, 'Practice set:', '\nLearner responses:')) as {
    quiz: Array<{ id: string; concept_id: string; answer_key: string }>;
  };
  const responses = JSON.parse(section(prompt, 'Learner responses:')) as Array<{
    question_id: string; answer: string;
  }>;
  const questions = new Map(practice.quiz.map(item => [item.id, item]));
  const results = responses.map(response => {
    const question = questions.get(response.question_id)!;
    const expected = tokens(question.answer_key);
    const actual = tokens(response.answer);
    const uncertain = isUncertain(response.answer);
    const matched = uncertain ? [] : [...expected].filter(token => matchesExpected(token, actual));
    const score = uncertain || !expected.size ? 0 : Math.min(1, matched.length / expected.size);
    const reason: DeterministicAssessmentReason = uncertain
      ? 'uncertain'
      : score >= 0.8
        ? 'mastered'
        : score > 0
          ? 'partial_match'
          : 'insufficient_evidence';
    return {
      question_id: response.question_id,
      concept_id: question.concept_id,
      score,
      feedback: feedbackFor(reason, spanish),
      matched_elements: matched,
      missing_elements: [...expected].filter(token => !matched.includes(token)),
      reason_code: reason,
    };
  });
  const mastered = results.filter(item => item.reason_code === 'mastered').length;
  const uncertain = results.filter(item => item.reason_code === 'uncertain').length;
  return {
    results,
    calibration_version: 'deterministic-bilingual-v1',
    summary: spanish
      ? `${mastered} de ${results.length} respuestas dominaron el concepto; ${uncertain} expresaron incertidumbre.`
      : `${mastered} of ${results.length} responses mastered the concept; ${uncertain} expressed uncertainty.`,
  };
}

export class DeterministicDemoProvider implements ModelProvider {
  readonly id = 'deterministic-demo';

  async generateStructured<T extends z.ZodType>(
    request: StructuredGenerationRequest<T>,
  ): Promise<z.infer<T>> {
    const value = ({
      document_analyzer: documentAnalysis,
      learning_planner: learningPlan,
      practice_designer: practiceSet,
      assessment_grader: assessment,
    } as Record<string, (prompt: string) => unknown>)[request.name]?.(request.prompt);
    if (value === undefined) throw new Error(`Deterministic demo does not support agent: ${request.name}`);
    return request.schema.parse(value);
  }
}
