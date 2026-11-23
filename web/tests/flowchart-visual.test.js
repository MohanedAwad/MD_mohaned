import { describe, expect, test } from 'vitest';
import {
  parseFlowchart, boxShape, setBoxShape, boxColor, setBoxColor, addConnectedBox,
  arrowInfo, setArrowStyle, readArrow, writeArrow, reverseArrow, reconnectArrow, arrowColor, setArrowColor, deleteArrow,
  direction, setDirection, groups, boxGroup, moveToGroup, addGroup, renameGroup, groupDirection, setGroupDirection, ungroup,
  boxLabel,
} from '../src/lib/flowchart.js';

const PLAN = `flowchart LR
  Owner([Owner]) -->|voice| Apps
  subgraph A9["A9 device"]
    Apps["Apps - screens only"]
    TTS["Android TTS"]
  end
  subgraph CF["Cloudflare"]
    Hub["a9-hub Worker"]
    D1[(D1 database)]
    Hub -.->|reads and writes| D1
  end
  GH[GitHub] -->|webhook| Hub
  Apps -->|speak text| TTS
  linkStyle 3 stroke:#d97706`;

const pairs = (code) => parseFlowchart(code).edges.map((e) => `${e.from}>${e.to}`);

describe('shapes', () => {
  test('every shape round-trips and keeps the label', () => {
    for (const key of ['rect', 'round', 'stadium', 'subroutine', 'database', 'circle', 'double-circle', 'diamond', 'hexagon', 'flag', 'lean-right', 'lean-left', 'trapezoid', 'trapezoid-alt']) {
      const code = setBoxShape(PLAN, 'Hub', key).code;
      expect(boxShape(code, 'Hub')).toBe(key);
      expect(boxLabel(code, 'Hub')).toBe('a9-hub Worker');
      expect(pairs(code)).toEqual(pairs(PLAN));
    }
  });

  test('square to database', () => {
    expect(setBoxShape(PLAN, 'GH', 'database').code).toContain('GH[(GitHub)] -->|webhook| Hub');
    expect(boxShape(PLAN, 'D1')).toBe('database');
  });

  test('a bare box gets a shape around its id', () => {
    expect(setBoxShape('flowchart TD\n  A --> B', 'B', 'diamond').code).toBe('flowchart TD\n  A --> B{B}');
  });
});

describe('colours', () => {
  test('set, read, replace, clear', () => {
    let code = setBoxColor(PLAN, 'Hub', 'purple').code;
    expect(code).toContain('style Hub fill:#ede9fe,stroke:#7c3aed,color:#0b1220');
    expect(boxColor(code, 'Hub')).toBe('purple');
    code = setBoxColor(code, 'Hub', 'green').code;
    expect(code.match(/style Hub/g)).toHaveLength(1);
    expect(boxColor(setBoxColor(code, 'Hub', null).code, 'Hub')).toBeNull();
  });

  test('arrow colour through linkStyle, replacing its own line', () => {
    expect(arrowColor(PLAN, 'Apps', 'TTS', 3)).toBe('amber');
    const code = setArrowColor(PLAN, 'Apps', 'TTS', 3, 'blue').code;
    expect(code).toContain('linkStyle 3 stroke:#2563eb');
    expect(code).not.toContain('#d97706');
    expect(arrowColor(code, 'Apps', 'TTS', 3)).toBe('blue');
  });

  test('a colour stays on its arrow when an earlier arrow is deleted', () => {
    const code = deleteArrow(PLAN, 'Owner', 'Apps', 0).code;
    expect(code).toContain('linkStyle 2 stroke:#d97706');
    expect(arrowColor(code, 'Apps', 'TTS', 2)).toBe('amber');
  });
});

describe('arrow style', () => {
  test('every line and end writes and reads back', () => {
    for (const line of ['solid', 'dotted', 'thick']) {
      for (const head of ['arrow', 'none', 'circle', 'cross']) {
        for (const both of head === 'none' ? [false] : [false, true]) {
          expect(readArrow(writeArrow({ line, head, both }))).toEqual({ line, head, both });
        }
      }
    }
    expect(writeArrow({ line: 'dotted', head: 'arrow', both: true })).toBe('<-.->');
    expect(writeArrow({ line: 'thick', head: 'none', both: false })).toBe('===');
  });

  test('change the line, keep the label', () => {
    const code = setArrowStyle(PLAN, 'GH', 'Hub', 2, { line: 'dotted' }).code;
    expect(code).toContain('GH[GitHub] -.->|webhook| Hub');
    expect(arrowInfo(code, 'GH', 'Hub', 2)).toEqual({ line: 'dotted', head: 'arrow', both: false, label: 'webhook' });
    expect(setArrowStyle(PLAN, 'GH', 'Hub', 2, { head: 'arrow', both: true }).code).toContain('GH[GitHub] <-->|webhook| Hub');
    expect(setArrowStyle(PLAN, 'GH', 'Hub', 2, { line: 'invisible' }).code).toContain('GH[GitHub] ~~~ Hub');
  });
});

describe('reverse and reconnect', () => {
  test('reverse keeps both definitions and the label', () => {
    const code = reverseArrow(PLAN, 'GH', 'Hub', 2).code;
    expect(code).toContain('Hub -->|webhook| GH[GitHub]');
    expect(pairs(code)).toContain('Hub>GH');
  });

  test('move the end to another box; the box it left keeps its definition', () => {
    const code = reconnectArrow(PLAN, 'GH', 'Hub', 2, 'to', 'D1').code;
    expect(code).toContain('GH[GitHub] -->|webhook| D1');
    expect(pairs(code)).not.toContain('GH>Hub');
  });

  test('move the start: GitHub loses its only arrow but stays as a box', () => {
    const code = reconnectArrow(PLAN, 'GH', 'Hub', 2, 'from', 'Apps').code;
    expect(code).toContain('Apps -->|webhook| Hub');
    expect(code).toMatch(/^\s+GH\[GitHub\]$/m);
  });

  test('the colour follows a reconnected arrow', () => {
    const code = reconnectArrow(PLAN, 'Apps', 'TTS', 3, 'to', 'Hub').code;
    expect(code).toContain('linkStyle 3 stroke:#d97706');
    expect(pairs(code)[3]).toBe('Apps>Hub');
  });

  test('an arrow inside a chain is rewritten on its own line', () => {
    const code = reconnectArrow('flowchart TD\n  A --> B --> C', 'B', 'C', 1, 'to', 'A').code;
    expect(pairs(code).sort()).toEqual(['A>B', 'B>A']);
  });

  test('new connected box', () => {
    const { code, id } = addConnectedBox(PLAN, 'Hub');
    expect(id).toBe('n1');
    expect(code).toContain('  Hub --> n1[New box]');
  });
});

describe('direction', () => {
  test('read and set', () => {
    expect(direction(PLAN)).toBe('LR');
    expect(direction('graph TD\nA-->B')).toBe('TB');
    expect(setDirection(PLAN, 'TB').code.split('\n')[0]).toBe('flowchart TB');
    expect(setDirection('flowchart\n  A --> B', 'RL').code).toBe('flowchart RL\n  A --> B');
  });
});

describe('groups', () => {
  test('list and membership', () => {
    expect(groups(PLAN)).toEqual([{ id: 'A9', title: 'A9 device' }, { id: 'CF', title: 'Cloudflare' }]);
    expect(boxGroup(PLAN, 'Hub')).toBe('CF');
    expect(boxGroup(PLAN, 'GH')).toBeNull();
  });

  test('move a box into a group: its definition goes in, the arrow stays outside', () => {
    const code = moveToGroup(PLAN, 'GH', 'CF').code;
    expect(boxGroup(code, 'GH')).toBe('CF');
    expect(code).toContain('    GH[GitHub]\n  end');
    expect(code).toContain('  GH -->|webhook| Hub');
    expect(pairs(code).sort()).toEqual(pairs(PLAN).sort());
  });

  test('move a box between groups; an arrow inside its old group moves out', () => {
    const code = moveToGroup(PLAN, 'D1', 'A9').code;
    expect(boxGroup(code, 'D1')).toBe('A9');
    expect(boxGroup(code, 'Hub')).toBe('CF');
    expect(code).toMatch(/^ {2}Hub -\.->\|reads and writes\| D1$/m);
    expect(pairs(code).sort()).toEqual(pairs(PLAN).sort());
  });

  test('take a box out of its group', () => {
    const code = moveToGroup(PLAN, 'TTS', null).code;
    expect(boxGroup(code, 'TTS')).toBeNull();
    expect(code).toContain('TTS["Android TTS"]');
    expect(boxLabel(code, 'TTS')).toBe('Android TTS');
  });

  test('new group around a box, and an empty one with its own box', () => {
    let out = addGroup(PLAN, 'Sources', 'GH');
    expect(out.id).toBe('g1');
    expect(boxGroup(out.code, 'GH')).toBe('g1');
    out = addGroup(PLAN);
    expect(boxGroup(out.code, out.box)).toBe(out.id);
  });

  test('rename keeps the id', () => {
    const code = renameGroup(PLAN, 'CF', 'Cloudflare (planned)').code;
    expect(code).toContain('subgraph CF["Cloudflare (planned)"]');
    expect(renameGroup('flowchart TD\n  subgraph Box\n    A\n  end', 'Box', 'My box').code).toContain('subgraph Box[My box]');
  });

  test('direction inside a group', () => {
    let code = setGroupDirection(PLAN, 'CF', 'TB').code;
    expect(code).toContain('subgraph CF["Cloudflare"]\n    direction TB\n');
    expect(groupDirection(code, 'CF')).toBe('TB');
    code = setGroupDirection(code, 'CF', null).code;
    expect(groupDirection(code, 'CF')).toBeNull();
  });

  test('ungroup keeps the boxes and arrows', () => {
    const code = ungroup(PLAN, 'CF').code;
    expect(groups(code).map((g) => g.id)).toEqual(['A9']);
    expect(code).toContain('\n  Hub["a9-hub Worker"]\n');
    expect(pairs(code)).toEqual(pairs(PLAN));
    expect(code).toContain('linkStyle 3 stroke:#d97706');
  });
});
