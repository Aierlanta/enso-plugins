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
  border-radius: var(--radius, 8px);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.pstack-auto:hover {
  background: var(--muted);
  color: var(--foreground);
}
.pstack-auto[data-on='true'] {
  background: color-mix(in oklab, var(--primary) 14%, transparent);
  color: var(--primary);
}
.pstack-auto svg {
  width: 14px;
  height: 14px;
}
`;

const ICON = [
  'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
  'M20 3v4',
  'M22 5h-4',
  'M4 17v2',
  'M5 18H3',
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
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        ICON.map((d) => h('path', { key: d, d }))
      )
    );
  }

  enso.slots.register({ slot: 'composer.left', component: AutoButton });
  return () => {
    style.remove();
  };
}
