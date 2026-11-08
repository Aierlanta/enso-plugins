// 宿主渲染模块：导出 onLoad，tool.card 是 React 组件，入参只有 output / state。

const HEADER = '| Severity | Location (file:line) | Finding |';

const muted = { fontSize: 12, color: 'var(--muted-foreground)', margin: '4px 0' };
const okStyle = { fontSize: 12, fontWeight: 600, color: 'var(--success, #16a34a)', margin: '4px 0' };
const rowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
  padding: '4px 0',
  borderBottom: '1px solid var(--border)',
};
const btn = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  flex: 'none',
};

function parseLocation(raw) {
  const cleaned = String(raw ?? '').trim().replace(/^`+|`+$/g, '');
  const match = /^(.+?):(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(cleaned);
  if (!match) return { file: cleaned || 'unknown', startLine: 1, endLine: 1 };
  const startLine = Math.max(1, Number(match[2]) || 1);
  const endLine = Math.max(startLine, Number(match[3] ?? match[2]) || startLine);
  return { file: match[1].trim(), startLine, endLine };
}

function parseTable(output) {
  const findings = [];
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length < 3 || cells.every((cell) => /^[-:\s]+$/.test(cell))) continue;
    if (/^severity$/i.test(cells[0]) && /location/i.test(cells[1])) continue;
    const loc = parseLocation(cells[1]);
    const description = cells
      .slice(2)
      .join(' | ')
      .replace(/\\\|/g, '|')
      .trim();
    if (!loc.file || !description) continue;
    findings.push({
      severity: cells[0].replace(/\*+/g, '').trim().toLowerCase() || 'medium',
      file: loc.file,
      startLine: loc.startLine,
      endLine: loc.endLine,
      description,
    });
  }
  return findings;
}

function call(enso, method, args) {
  return enso.dispatch('plugin.call', { method, args: args || {} });
}

export function onLoad(enso) {
  const { createElement: h } = enso.React;

  function PrepareCard({ output, state }) {
    if (state !== 'ok' || !output) return null;
    const text = String(output);
    if (
      text.startsWith('Not enough changes') ||
      text.startsWith('Failed to collect git diff') ||
      text.startsWith('Diff is too large')
    ) {
      return h('div', { style: muted }, text.split('\n')[0]);
    }
    if (!text.includes('Full Repository Path:')) return null;
    return h('div', { style: muted }, 'Bugbot context ready.');
  }

  function ReportCard({ output, state }) {
    const { useState } = enso.React;
    const [fixedKeys, setFixedKeys] = useState(() => new Set());
    if (state !== 'ok' || !output) return null;
    const text = String(output);
    if (!text.includes(HEADER)) {
      return /bugbot found no bugs/i.test(text)
        ? h('div', { style: okStyle }, 'Bugbot found no bugs')
        : null;
    }
    const findings = parseTable(text);
    if (findings.length === 0) return h('div', { style: okStyle }, 'Bugbot found no bugs');
    const rows = findings.slice(0, 8).map((finding) => {
      const loc =
        finding.endLine > finding.startLine
          ? `${finding.file}:${finding.startLine}-${finding.endLine}`
          : `${finding.file}:${finding.startLine}`;
      const key = `${loc}\0${finding.description}`;
      const fixed = fixedKeys.has(key);
      return h('div', { key: `${loc}\0${finding.description}`, style: rowStyle }, [
        h('div', { style: { fontSize: 12 } }, [
          h('span', { style: { fontWeight: 600, marginRight: 6 } }, fixed ? '[fixed]' : `[${finding.severity}]`),
          h(
            'span',
            {
              style: {
                fontFamily: 'ui-monospace, Menlo, monospace',
                color: 'var(--muted-foreground)',
                marginRight: 6,
              },
            },
            loc
          ),
          h('span', null, finding.description),
        ]),
        h(
          'button',
          {
            type: 'button',
            style: btn,
            disabled: fixed,
            title: 'Seed Fix in Chat prompt into composer',
            onClick: () => {
              setFixedKeys((prev) => new Set(prev).add(key));
              return call(enso, 'fixInChat', { finding });
            },
          },
          fixed ? '已修复' : 'Fix in Chat'
        ),
      ]);
    });
    return h('div', { style: { margin: '4px 0' } }, [
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        [
          h('span', { style: { fontSize: 12, fontWeight: 600 } }, `Bugbot Findings (${findings.length})`),
          h(
            'button',
            { type: 'button', style: btn, onClick: () => call(enso, 'fixAllInChat', {}) },
            'Fix All in Chat'
          ),
        ]
      ),
      ...rows,
    ]);
  }

  function Action({ text }) {
    if (typeof text !== 'string' || !text.includes(HEADER)) return null;
    return h(
      'button',
      {
        type: 'button',
        style: btn,
        title: 'Insert Fix All prompt for Bugbot findings into composer',
        onClick: () => call(enso, 'fixAllInChat', {}),
      },
      'Fix All Findings'
    );
  }

  enso.slots.register({ slot: 'tool.card', toolName: 'bugbot_prepare', component: PrepareCard });
  enso.slots.register({ slot: 'tool.card', toolName: 'bugbot_report', component: ReportCard });
  enso.slots.register({ slot: 'message.action', position: 'right', component: Action });
}
