import { describe, expect, test } from 'vitest';
import { edgeEnds, nodeKey } from '../src/lib/diagram.js';

describe('mermaid flowchart ids', () => {
  test('box id from its element id', () => {
    expect(nodeKey('flowchart-UI-0')).toBe('UI');
    expect(nodeKey('flowchart-test_cases.service-12')).toBe('test_cases.service');
    expect(nodeKey('flowchart-my-node-3')).toBe('my-node');
  });

  test('arrow ends, including ids that contain underscores', () => {
    const ids = new Set(['UI', 'R', 'test_cases', 'runner_launch', 'a', 'a_b']);
    expect(edgeEnds('L_UI_R_0', ids)).toEqual(['UI', 'R']);
    expect(edgeEnds('L_test_cases_runner_launch_7', ids)).toEqual(['test_cases', 'runner_launch']);
    expect(edgeEnds('L_a_b_a_2', ids)).toEqual(['a_b', 'a']);
  });

  test('unknown arrows are skipped, not guessed', () => {
    expect(edgeEnds('L_X_Y_0', new Set(['UI']))).toBeNull();
    expect(edgeEnds('', new Set(['UI']))).toBeNull();
  });
});
