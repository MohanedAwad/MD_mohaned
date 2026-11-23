import { describe, expect, test } from 'vitest';
import {
  parseFlowchart, addBox, addArrow, deleteBox, deleteArrow, boxLabel, setBoxLabel, arrowLabel, setArrowLabel,
} from '../src/lib/flowchart.js';
import { findMermaidBlock, blockCode, replaceBlock } from '../src/lib/diagram.js';

const A9 = `flowchart LR
  subgraph A9["A9 · Android"]
    APK["16 app/service APKs · diagrams below"]
    Look["Boot logo [only while open]<br/>assets"]
  end
  subgraph CF["Cloudflare"]
    W["a9-hub Worker"]
    D[(D1 database)]
  end
  Owner([Owner]) -->|voice, buttons| APK
  APK -->|"HTTPS"| W
  W -.->|reads and writes| D
  GH[GitHub] -- webhook --> W
  classDef cloud fill:#f1e8ff
  class W,D,GH cloud
  linkStyle 1 stroke:#2563eb
  linkStyle 3 stroke:#d4a72c`;

describe('reading flowchart code', () => {
  test('arrows are numbered in the order mermaid numbers them', () => {
    const { edges, understood } = parseFlowchart(A9);
    expect(understood).toBe(true);
    expect(edges.map((e) => `${e.index}:${e.from}>${e.to}`)).toEqual(['0:Owner>APK', '1:APK>W', '2:W>D', '3:GH>W']);
  });

  test('chains and & groups give one arrow per pair', () => {
    const { edges } = parseFlowchart('flowchart TD\n  A & B --> C --> D');
    expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual(['A>C', 'B>C', 'C>D']);
  });

  test('every arrow form is read', () => {
    const code = 'graph TD\nA --- B\nB -.-> C\nC ==> D\nD -- text --> E\nE -. dotted .-> F\nF == thick ==> G\nG <--> H\nH --o I\nI ~~~ J';
    const { edges, understood } = parseFlowchart(code);
    expect(understood).toBe(true);
    expect(edges).toHaveLength(9);
  });

  test('a line it cannot read is marked, not guessed', () => {
    expect(parseFlowchart('flowchart TD\n  A --> B\n  this is not ( mermaid').understood).toBe(false);
  });
});

describe('boxes', () => {
  test('add: next free id, at the top-level indent, after the last line', () => {
    const { code, line, id } = addBox(A9);
    expect(id).toBe('n1');
    expect(code.split('\n')[line]).toBe('  n1[New box]');
    expect(line).toBe(A9.split('\n').length);
    expect(addBox('flowchart TD\n  n1[x]').id).toBe('n2');
  });

  test('rename keeps quotes and the shape', () => {
    expect(boxLabel(A9, 'Look')).toBe('Boot logo [only while open]<br/>assets');
    expect(setBoxLabel(A9, 'W', 'a9-hub Worker v2').code).toContain('W["a9-hub Worker v2"]');
    expect(setBoxLabel(A9, 'D', 'D1').code).toContain('D[(D1)]');
    expect(setBoxLabel(A9, 'Owner', 'Me').code).toContain('Owner([Me]) -->|voice, buttons| APK');
  });

  test('rename quotes text that mermaid would read as syntax', () => {
    expect(setBoxLabel(A9, 'GH', 'GitHub (app)').code).toContain('GH["GitHub (app)"] -- webhook --> W');
    expect(setBoxLabel(A9, 'GH', 'say "hi"').code).toContain('GH["say #quot;hi#quot;"]');
  });

  test('rename a box written only as a bare id gives it a label', () => {
    expect(setBoxLabel('flowchart TD\n  A --> B', 'B', 'Bee').code).toBe('flowchart TD\n  A --> B[Bee]');
  });

  test('delete removes its line, its arrows, its class entry, and renumbers linkStyle', () => {
    const { code } = deleteBox(A9, 'W');
    expect(code).not.toMatch(/\bW\b/);
    expect(code).toContain('class D,GH cloud');
    // APK -> W (1) and GH -> W (3) are gone; W -> D (2) too. Only arrow 0 is left, so both linkStyles go.
    expect(code).not.toContain('linkStyle');
    // GitHub keeps its box though its only arrow went; D keeps its definition line.
    expect(code).toContain('  GH[GitHub]');
    expect(code).toContain('D[(D1 database)]');
    expect(parseFlowchart(code).edges.map((e) => `${e.from}>${e.to}`)).toEqual(['Owner>APK']);
  });

  test('delete in the middle of a chain keeps both ends', () => {
    expect(deleteBox('flowchart TD\n  A --> B --> C', 'B').code).toBe('flowchart TD\n  A\n  C');
    expect(deleteBox('flowchart TD\n  A --> B --> C\n  A[Start]\n  C[End]', 'B').code).toBe('flowchart TD\n  A[Start]\n  C[End]');
  });

  test('delete from an & group keeps the others', () => {
    expect(deleteBox('flowchart TD\n  A & B --> C', 'B').code).toBe('flowchart TD\n  A --> C');
  });

  test('delete drops style and click lines for that box only', () => {
    const code = 'flowchart TD\n  A --> B\n  style A fill:#f00\n  style B fill:#0f0\n  click A "https://x"';
    expect(deleteBox(code, 'A').code).toBe('flowchart TD\n  B\n  style B fill:#0f0');
  });

  test('an unknown box is an error, not a silent no-op', () => {
    expect(() => deleteBox(A9, 'Nope')).toThrow(/Nope/);
  });
});

describe('arrows', () => {
  test('add', () => {
    const { code, line } = addArrow(A9, 'GH', 'D');
    expect(code.split('\n')[line]).toBe('  GH --> D');
  });

  test('delete keeps both boxes and shifts linkStyle numbers', () => {
    const { code } = deleteArrow(A9, 'Owner', 'APK', 0);
    expect(code).toContain('  Owner([Owner])\n');
    expect(code).toContain('linkStyle 0 stroke:#2563eb');
    expect(code).toContain('linkStyle 2 stroke:#d4a72c');
  });

  test('delete a bare arrow drops the line when both boxes live elsewhere', () => {
    expect(deleteArrow('flowchart TD\n  A[a]\n  B[b]\n  A --> B', 'A', 'B', 0).code).toBe('flowchart TD\n  A[a]\n  B[b]');
  });

  test('delete one arrow of a chain or & group', () => {
    // C is written nowhere else, so it stays as a box of its own.
    expect(deleteArrow('flowchart TD\n  A --> B --> C', 'B', 'C', 1).code).toBe('flowchart TD\n  A --> B\n  C');
    expect(deleteArrow('flowchart TD\n  A --> B --> C\n  C[End]', 'B', 'C', 1).code).toBe('flowchart TD\n  A --> B\n  C[End]');
    // B loses its only arrow but stays a box.
    expect(deleteArrow('flowchart TD\n  A & B --> C', 'B', 'C', 1).code).toBe('flowchart TD\n  B\n  A --> C');
  });

  test('two arrows between the same boxes: the number picks one', () => {
    const code = 'flowchart TD\n  A -->|one| B\n  A -->|two| B';
    expect(deleteArrow(code, 'A', 'B', 1).code).toBe('flowchart TD\n  A -->|one| B');
  });

  test('labels: read, change, add, clear, in every form', () => {
    expect(arrowLabel(A9, 'APK', 'W', 1)).toBe('HTTPS');
    expect(setArrowLabel(A9, 'APK', 'W', 1, 'TLS').code).toContain('APK -->|"TLS"| W');
    expect(arrowLabel(A9, 'GH', 'W', 3)).toBe('webhook');
    expect(setArrowLabel(A9, 'GH', 'W', 3, 'push').code).toContain('GH[GitHub] -->|push| W');
    expect(setArrowLabel(A9, 'W', 'D', 2, '').code).toContain('W -.-> D');
    expect(setArrowLabel('graph TD\nA -. x .-> B', 'A', 'B', 0, 'y').code).toBe('graph TD\nA -.->|y| B');
    expect(setArrowLabel('graph TD\nA --> B', 'A', 'B', 0, 'new').code).toBe('graph TD\nA -->|new| B');
  });
});

describe('finding the block in the Markdown', () => {
  const md = `# Plan\n\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\`\n\ntext\n\n\`\`\`mermaid\nflowchart TD\n  C --> D\n\`\`\`\n`;

  test('finds the block whose code matches, from the given line', () => {
    const b = findMermaidBlock(md, 9, 'flowchart TD\n  C --> D');
    expect(b).toEqual({ start: 10, end: 12, indent: '' });
    expect(blockCode(md, b)).toBe('flowchart TD\n  C --> D');
  });

  test('writes new code back and tracks the new size', () => {
    const b = findMermaidBlock(md, 1, 'flowchart TD\n  A --> B');
    const out = replaceBlock(md, b, 'flowchart TD\n  A --> B\n  B --> C');
    expect(out.text).toContain('```mermaid\nflowchart TD\n  A --> B\n  B --> C\n```\n\ntext');
    expect(blockCode(out.text, out.block)).toBe('flowchart TD\n  A --> B\n  B --> C');
  });

  test('a block indented in a list keeps its indent', () => {
    const listed = '- item\n\n  ```mermaid\n  flowchart TD\n    A --> B\n  ```\n';
    const b = findMermaidBlock(listed, 1, 'flowchart TD\n  A --> B');
    expect(replaceBlock(listed, b, 'flowchart TD\n  A --> C').text).toBe('- item\n\n  ```mermaid\n  flowchart TD\n    A --> C\n  ```\n');
  });
});
