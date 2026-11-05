const PRESET = 'plugin:enso.pstack:poteto';

const STYLE = `
.pstack-auto {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.pstack-auto .potato {
  width: 16px;
  height: 16px;
  overflow: visible;
  pointer-events: none;
  filter: grayscale(1);
  opacity: 0.45;
  transition: filter 0.15s, opacity 0.15s, transform 0.15s;
}
.pstack-auto:hover .potato {
  opacity: 0.72;
  transform: scale(1.08);
}
.pstack-auto:active .potato {
  transform: scale(0.94);
}
.pstack-auto[data-on='true'] .potato {
  filter: none;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .pstack-auto .potato {
    transition: none;
  }
  .pstack-auto:hover .potato,
  .pstack-auto:active .potato {
    transform: none;
  }
}
`;

const POTATO =
  'M119 1C127 1 139 2 146 4C153 6 158 9 163 13C168 17 172 20 176 26C180 33 186 44 189 52C192 60 193 63 193 74C194 85 194 106 192 119C190 132 187 141 183 150C179 159 175 166 169 173C163 181 153 190 145 195C138 201 131 203 124 206C117 209 111 211 103 212C95 213 85 214 78 214C71 214 66 213 59 211C52 209 42 205 35 200C28 195 21 189 16 182C11 175 6 167 4 159C2 151 1 142 2 133C4 124 6 113 13 103C20 93 36 81 43 71C51 61 52 52 58 43C64 35 70 26 77 20C84 14 93 9 100 6C107 3 111 1 119 1Z';

const EYES = [
  [143, 53, 11, 7.2, -24],
  [75, 91, 10, 6.6, -18],
  [154, 110, 9, 6.2, -12],
  [40, 139, 9.5, 6.4, -20],
  [110, 155, 11.5, 7, -16],
];

export function onLoad(enso) {
  const { React } = enso;
  const h = React.createElement;
  const style = document.createElement('style');
  style.dataset.plugin = 'enso.pstack';
  style.textContent = STYLE;
  document.head.appendChild(style);

  function AutoButton(props) {
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : null;
    const pstack = props.pluginPresetId === PRESET;
    const [on, setOn] = React.useState(false);
    const seq = React.useRef(0);

    React.useEffect(() => {
      setOn(false);
      if (!sessionId) return undefined;
      const ticket = ++seq.current;
      let live = true;
      enso
        .dispatch('plugin.call', { method: 'session', args: { sessionId, pstack } })
        .then((result) => {
          if (live && ticket === seq.current && typeof result?.on === 'boolean') setOn(result.on);
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [sessionId, pstack]);

    if (!pstack || !sessionId) return null;

    const title = on
      ? 'poteto-mode 已开启：本会话每条消息前自动加 /skill:poteto-mode'
      : '开启 poteto-mode：本会话每条消息前自动加 /skill:poteto-mode';
    return h(
      'button',
      {
        type: 'button',
        className: 'pstack-auto',
        'data-on': on ? 'true' : 'false',
        title,
        'aria-pressed': on,
        'aria-label': title,
        onMouseDown: (event) => {
          event.preventDefault();
        },
        onClick: () => {
          const ticket = ++seq.current;
          enso
            .dispatch('plugin.call', { method: 'toggle', args: { sessionId, pstack } })
            .then((result) => {
              if (ticket === seq.current && typeof result?.on === 'boolean') setOn(result.on);
            })
            .catch(() => {});
        },
      },
      h(
        'svg',
        { className: 'potato', viewBox: '0 0 229 240', 'aria-hidden': true },
        h('defs', null, h('clipPath', { id: 'pstack-potato' }, h('path', { d: POTATO }))),
        h('path', { fill: '#E19D3D', d: POTATO }),
        h('ellipse', { cx: 118, cy: 72, rx: 86, ry: 58, fill: '#F6BE67', clipPath: 'url(#pstack-potato)' }),
        h('path', { fill: 'none', stroke: '#5C2C0C', strokeWidth: 15, strokeLinejoin: 'round', d: POTATO }),
        EYES.map(([cx, cy, rx, ry, rot]) =>
          h('ellipse', {
            key: cx,
            cx,
            cy,
            rx,
            ry,
            fill: '#964C0F',
            transform: `rotate(${rot} ${cx} ${cy})`,
          })
        )
      )
    );
  }

  enso.slots.register({ slot: 'composer.left', component: AutoButton });
  return () => {
    style.remove();
  };
}
