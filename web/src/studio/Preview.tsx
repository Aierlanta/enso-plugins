import * as React from 'react';
import { createPortal } from 'react-dom';

import type { ThemeAssetState } from '../enso-theme/types';
import { MOCK_CSS } from './previewCss';

export type SessionState = 'idle' | ThemeAssetState;
export type MainView = 'empty' | 'new' | 'chat';

export interface PreviewState {
  dark: boolean;
  session: SessionState;
  activity: SessionState;
  live: boolean;
  view: MainView;
  reducedMotion: boolean;
}

const STATE_LABEL: Record<SessionState, string> = { idle: '空闲', running: '运行中', waiting: '等待你的回答', error: '出错了' };

function Mock({ state }: { state: PreviewState }) {
  return (
    <>
      <div aria-hidden className="m-bg">
        <div className="m-bg-media">
          <div className="m-bg-image" />
          <div className="m-bg-mask" />
        </div>
      </div>
      <div data-enso="canvas" className="m-canvas">
        <aside data-enso="sidebar" className="m-sidebar">
          <div className="m-group">enso-code</div>
          <div className={`m-item${state.view === 'empty' ? '' : ' on'}`}>
            <span className="m-dot" />
            {state.view === 'new' ? '新会话' : '重构主题加载流程'}
          </div>
          <div className="m-item">
            <span className="m-dot" />
            修复侧栏拖拽
          </div>
          <div className="m-group">enso-plugins</div>
          <div className="m-item">
            <span className="m-dot" />
            主题工坊
          </div>
        </aside>
        <div className="m-workspace">
          <div data-enso="main">
            {state.view !== 'empty' && (
              <>
                <div data-enso="title-bar">
                  <span className="m-title">
                    <span className="m-dot" />
                    {state.view === 'new' ? '新会话' : '重构主题加载流程'}
                  </span>
                </div>
                <div data-enso="timeline">
                  <div className="m-col">
                    {state.view === 'new' ? (
                      <div className="m-hello">
                        <b>enso-code</b>
                        今天想做点什么？
                      </div>
                    ) : (
                      <>
                        <div data-enso="message-user">
                          <div>把主题素材改成按会话状态换图</div>
                          <div className="m-meta">刚刚</div>
                        </div>
                        <div data-enso="message-assistant">
                          <div data-enso="thinking" data-live={state.live || undefined}>
                            <span className="m-think">{state.live ? '思考中…' : '已思考 8 秒'}</span>
                          </div>
                          <div data-enso="tool-row">读取 src/shared/theme/assets.ts</div>
                          <p>
                            槽位状态跟随 <code>data-enso-session</code>，下面是生成的规则：
                          </p>
                          <div data-enso="code-block">
                            <pre>
                              <span className="m-k">:root</span>[data-enso-session="running"] {'{\n'}
                              {'  --enso-asset-thinking: url("busy.webp");\n}'}
                            </pre>
                          </div>
                          <div data-enso="todo">
                            <div>
                              <span className="m-check done" />
                              读宿主槽位表
                            </div>
                            <div>
                              <span className="m-check now" />
                              接上状态属性
                            </div>
                            <div>
                              <span className="m-check" />
                              真机验证
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="m-bottom">
                  <div className="enso-chat-col m-col">
                    <div>
                      <div data-enso="composer">
                        <textarea placeholder="问点什么，@ 引用文件，/ 调用命令" />
                        <div className="m-tools">
                          <span className="m-chip">Claude</span>
                          <span className="m-chip">计划</span>
                          <span className="m-send">↑</span>
                        </div>
                      </div>
                    </div>
                    <div data-enso="status-line">
                      <span className="m-state">{STATE_LABEL[state.session]}</span>
                      <span>上下文 32%</span>
                      <span>main</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div data-enso="side-panel">
            <b>文件</b>
            <div className="m-file">src/</div>
            <div className="m-file on">　assets.ts</div>
            <div className="m-file">　themeFile.ts</div>
            <div className="m-file">docs/theming.md</div>
          </div>
        </div>
      </div>
    </>
  );
}

/** 同源 iframe：主题 CSS 只作用于模拟界面，状态属性写在它自己的 <html> 上 */
export function Preview({ css, state, className }: { css: string; state: PreviewState; className?: string }) {
  const [doc, setDoc] = React.useState<Document | null>(null);
  const themeStyle = React.useRef<HTMLStyleElement | null>(null);

  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const d = e.currentTarget.contentDocument;
    if (!d) return;
    const mock = d.createElement('style');
    mock.textContent = MOCK_CSS;
    themeStyle.current = d.createElement('style');
    d.head.append(mock, themeStyle.current);
    setDoc(d);
  };

  React.useEffect(() => {
    if (themeStyle.current) themeStyle.current.textContent = css;
  }, [css, doc]);

  React.useEffect(() => {
    if (!doc) return;
    const root = doc.documentElement;
    root.classList.toggle('dark', state.dark);
    root.dataset.ensoSession = state.session;
    root.dataset.ensoActivity = state.activity;
  }, [doc, state.dark, state.session, state.activity]);

  return (
    <>
      <iframe title="主题预览" srcDoc="<!doctype html><html><head><meta charset=utf-8></head><body></body></html>" onLoad={onLoad} className={className} />
      {doc && createPortal(<Mock state={state} />, doc.body)}
    </>
  );
}
