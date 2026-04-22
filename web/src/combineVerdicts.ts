import type { SmartVerdict } from './smartAlg';
import type { RLPrediction } from './hooks/useRLPrediction';

export type CombinedAction = 'ВХОД UP' | 'ВХОД DOWN' | 'ЖДАТЬ';

export interface CombinedVerdict {
  action: CombinedAction;
  confidence: number;
  agreed: boolean;
  rl: RLPrediction;
  sa: SmartVerdict;
}

export function combineVerdicts(rl: RLPrediction, sa: SmartVerdict): CombinedVerdict {
  // RL HOLD → ЖДАТЬ (не торгуем без обеих сторон)
  if (rl.action === 0) {
    return {
      action: 'ЖДАТЬ',
      confidence: sa.confidence * 0.4,
      agreed: false,
      rl,
      sa,
    };
  }

  // SA не готов (ПРОПУСТИТЬ/ОЖИДАЙТЕ) → ЖДАТЬ
  if (sa.action === 'ПРОПУСТИТЬ' || sa.action === 'ОЖИДАЙТЕ') {
    return {
      action: 'ЖДАТЬ',
      confidence: rl.confidence * 0.6,
      agreed: false,
      rl,
      sa,
    };
  }

  // SA direction для сравнения
  const saDirection = sa.direction; // 'UP' | 'DOWN' | 'NONE'
  const rlDirection = rl.action === 1 ? 'UP' : rl.action === 2 ? 'DOWN' : 'NONE';

  // Согласие RL и SA
  const agreed = rlDirection === saDirection && saDirection !== 'NONE';

  if (agreed) {
    // Обе стороны согласны → ВХОД с повышенной уверенностью
    const confidence = rl.confidence * 0.6 + sa.confidence * 0.4 + 0.15;
    const action: CombinedAction = rlDirection === 'UP' ? 'ВХОД UP' : 'ВХОД DOWN';
    return { action, confidence: Math.min(1, confidence), agreed: true, rl, sa };
  }

  // Несогласие → ЖДАТЬ
  return {
    action: 'ЖДАТЬ',
    confidence: Math.max(rl.confidence * 0.6, sa.confidence * 0.4),
    agreed: false,
    rl,
    sa,
  };
}