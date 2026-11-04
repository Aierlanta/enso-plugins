const PRESET = 'plugin:enso.pstack:poteto';

const STYLE = `
.pstack-auto {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.pstack-auto:hover,
.pstack-auto[data-on='true'] {
  background: var(--accent, rgba(15, 23, 42, 0.08));
  color: var(--foreground);
}
`;

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

    const title = '本会话每条消息前自动加 /skill:poteto-mode';
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
      'poteto'
    );
  }

  enso.slots.register({ slot: 'composer.left', component: AutoButton });
  return () => {
    style.remove();
  };
}
